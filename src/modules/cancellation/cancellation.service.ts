import type { UserRole } from "@prisma/client";
import { logger } from "../../config/logger.js";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import {
  bookingRepository,
  type IBookingRepository,
} from "../booking/booking.repository.js";
import { loadAuthorizedDelivery } from "../delivery/delivery-access.js";
import {
  deliveryRepository,
  type IDeliveryRepository,
} from "../delivery/delivery.repository.js";
import {
  deliveryLifecycleService,
  type DeliveryLifecycleService,
} from "../delivery/delivery-lifecycle.service.js";
import {
  providerRepository,
  type IProviderRepository,
} from "../provider/provider.repository.js";
import {
  ProviderAdapterExecutor,
  providerAdapterExecutor,
} from "../provider/adapters/provider-adapter-executor.js";
import {
  buildCancellationCorrelationReference,
} from "./cancellation.constants.js";
import {
  canCancelWithBooking,
  isProviderCancellationEligible,
} from "./cancellation.eligibility.js";
import {
  classifyCancellationError,
  resolveCancellationResult,
} from "./cancellation.provider-outcome.js";
import {
  cancellationRepository,
  type CancellationResponsePayload,
  type ICancellationRepository,
} from "./cancellation.repository.js";

export class CancellationService {
  constructor(
    private readonly deliveryRepo: IDeliveryRepository = deliveryRepository,
    private readonly bookingRepo: IBookingRepository = bookingRepository,
    private readonly providerRepo: IProviderRepository = providerRepository,
    private readonly cancellationRepo: ICancellationRepository = cancellationRepository,
    private readonly lifecycle: DeliveryLifecycleService = deliveryLifecycleService,
    private readonly adapterExecutor: ProviderAdapterExecutor = providerAdapterExecutor,
  ) {}

  async cancel(input: {
    deliveryId: string;
    userId: string;
    role: UserRole;
    requestId: string;
    reasonCode: string;
    reasonMessage?: string | null;
    idempotencyKey?: string;
    requestHash: string;
  }) {
    if (input.idempotencyKey) {
      const cached = await this.cancellationRepo.findIdempotency(
        input.userId,
        input.idempotencyKey,
      );
      if (cached) {
        if (
          cached.requestHash !== input.requestHash ||
          cached.deliveryId !== input.deliveryId
        ) {
          throw new AppError("Idempotency key reused with a different request.", {
            statusCode: 409,
            code: ErrorCodes.IDEMPOTENCY_CONFLICT,
          });
        }
        return { success: true as const, data: cached.responsePayload };
      }
    }

    const delivery = await loadAuthorizedDelivery(
      this.deliveryRepo,
      input.deliveryId,
      input.userId,
      input.role,
    );

    const latestBooking = await this.bookingRepo.findLatestByDeliveryId(
      input.deliveryId,
    );
    const eligibility = canCancelWithBooking({
      deliveryStatus: delivery.status,
      bookingStatus: latestBooking?.status ?? null,
    });

    if (!eligibility.allowed) {
      if (latestBooking?.status === "UNKNOWN") {
        throw new AppError(
          "Booking outcome is unknown. Reconciliation is required before cancellation.",
          {
            statusCode: 409,
            code: ErrorCodes.PROVIDER_BOOKING_RECONCILIATION_REQUIRED,
          },
        );
      }
      throw new AppError("Delivery cannot be cancelled.", {
        statusCode: 422,
        code: ErrorCodes.CANCELLATION_NOT_ALLOWED,
      });
    }

    const latestCancellation =
      await this.cancellationRepo.findLatestByDeliveryId(input.deliveryId);
    if (latestCancellation?.status === "UNKNOWN") {
      throw new AppError(
        "Cancellation outcome is unknown. Reconciliation is required before retrying.",
        {
          statusCode: 409,
          code: ErrorCodes.CANCELLATION_UNKNOWN,
        },
      );
    }

    const processing = await this.cancellationRepo.findProcessingByDeliveryId(
      input.deliveryId,
    );
    if (processing) {
      throw new AppError("Cancellation is already in progress.", {
        statusCode: 409,
        code: ErrorCodes.CANCELLATION_IN_PROGRESS,
      });
    }

    const attemptNumber = await this.cancellationRepo.getNextAttemptNumber(
      input.deliveryId,
    );
    const correlationReference = buildCancellationCorrelationReference(
      delivery.reference,
      attemptNumber,
    );

    const record = await this.cancellationRepo.create({
      deliveryId: input.deliveryId,
      providerBookingId: latestBooking?.id ?? null,
      providerId: latestBooking?.providerId ?? null,
      reasonCode: input.reasonCode,
      reasonMessage: input.reasonMessage ?? null,
      status: "PROCESSING",
      correlationReference,
      requestId: input.requestId,
    });

    logger.info(
      { deliveryId: input.deliveryId, cancellationId: record.id },
      "cancellation.started",
    );

    let resolved;
    if (eligibility.localOnly) {
      resolved = {
        outcome: "CANCELLED" as const,
        providerCancellationReference: null,
        cancelledAt: new Date(),
        failureCode: null,
        failureMessage: null,
      };
    } else {
      const provider = latestBooking
        ? await this.providerRepo.findById(latestBooking.providerId)
        : null;
      if (!provider || !isProviderCancellationEligible(provider)) {
        await this.cancellationRepo.finalize({
          cancellationId: record.id,
          status: "REJECTED",
          failureCode: ErrorCodes.PROVIDER_OPERATION_UNAVAILABLE,
          failureMessage: "Provider cancellation is unavailable.",
        });
        throw new AppError("Provider cancellation is unavailable.", {
          statusCode: 422,
          code: ErrorCodes.PROVIDER_OPERATION_UNAVAILABLE,
        });
      }

      try {
        const result = await this.adapterExecutor.execute({
          providerCode: latestBooking!.providerCode,
          operation: "cancelBooking",
          payload: {
            providerBookingId: latestBooking!.providerOrderId!,
            reason: input.reasonMessage ?? input.reasonCode,
          },
          requestId: input.requestId,
        });
        resolved = resolveCancellationResult(result);
      } catch (error) {
        resolved = classifyCancellationError(error);
      }
    }

    const now = new Date();
    const finalStatus =
      resolved.outcome === "CANCELLED"
        ? "CANCELLED"
        : resolved.outcome === "UNKNOWN"
          ? "UNKNOWN"
          : "REJECTED";

    const finalized = await this.cancellationRepo.finalize({
      cancellationId: record.id,
      status: finalStatus,
      providerCancellationReference: resolved.providerCancellationReference,
      cancelledAt: resolved.outcome === "CANCELLED" ? now : null,
      failureCode: resolved.failureCode,
      failureMessage: resolved.failureMessage,
    });

    if (finalStatus === "CANCELLED") {
      await this.lifecycle.transition({
        deliveryId: input.deliveryId,
        currentStatus: delivery.status,
        toStatus: "CANCELLED",
        expectedFromStatuses: [delivery.status],
        source: "CUSTOMER",
        reason: "Delivery cancelled",
        metadata: { cancellationId: finalized.id },
      });
    }

    const refreshed = await this.deliveryRepo.findById(input.deliveryId);
    const response: CancellationResponsePayload = {
      delivery: {
        id: delivery.id,
        reference: delivery.reference,
        status: refreshed?.status ?? delivery.status,
      },
      cancellation: {
        id: finalized.id,
        status: finalized.status,
        reasonCode: finalized.reasonCode,
        cancelledAt: finalized.cancelledAt?.toISOString() ?? null,
      },
    };

    if (input.idempotencyKey) {
      try {
        await this.cancellationRepo.saveIdempotency({
          customerId: input.userId,
          key: input.idempotencyKey,
          requestHash: input.requestHash,
          deliveryId: input.deliveryId,
          responsePayload: response,
        });
      } catch {
        // best effort
      }
    }

    if (finalStatus === "REJECTED") {
      throw new AppError(
        finalized.failureMessage ?? "Cancellation was rejected.",
        {
          statusCode: 422,
          code: ErrorCodes.PROVIDER_CANCELLATION_REJECTED,
        },
      );
    }

    if (finalStatus === "UNKNOWN") {
      throw new AppError("Cancellation outcome is unknown.", {
        statusCode: 503,
        code: ErrorCodes.CANCELLATION_UNKNOWN,
      });
    }

    logger.info(
      { deliveryId: input.deliveryId, cancellationId: finalized.id },
      "cancellation.succeeded",
    );

    return { success: true as const, data: response };
  }

  async getCancellation(input: {
    deliveryId: string;
    userId: string;
    role: UserRole;
  }) {
    await loadAuthorizedDelivery(
      this.deliveryRepo,
      input.deliveryId,
      input.userId,
      input.role,
    );
    const cancellation = await this.cancellationRepo.findLatestByDeliveryId(
      input.deliveryId,
    );
    if (!cancellation) {
      throw new AppError("Cancellation not found.", {
        statusCode: 404,
        code: ErrorCodes.CANCELLATION_NOT_FOUND,
      });
    }
    const delivery = await this.deliveryRepo.findById(input.deliveryId);
    return {
      success: true as const,
      data: {
        delivery: {
          id: input.deliveryId,
          reference: delivery?.reference ?? "",
          status: delivery?.status ?? "CREATED",
        },
        cancellation: {
          id: cancellation.id,
          status: cancellation.status,
          reasonCode: cancellation.reasonCode,
          cancelledAt: cancellation.cancelledAt?.toISOString() ?? null,
          failureCode: cancellation.failureCode,
          failureMessage: cancellation.failureMessage,
        },
      },
    };
  }
}

export const cancellationService = new CancellationService();
