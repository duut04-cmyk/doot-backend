import type { UserRole } from "@prisma/client";
import { logger } from "../../config/logger.js";
import {
  DEFAULT_BOOKING_PRICE_TOLERANCE_PERCENT,
  DEFAULT_BOOKING_QUOTE_MAX_AGE_SECONDS,
} from "../../config/env.js";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import {
  deliveryRepository,
  toDeliveryDetailDto,
  type IDeliveryRepository,
} from "../delivery/delivery.repository.js";
import {
  toBookingRequest,
  toQuoteRequest,
} from "../provider/adapters/delivery-provider.mapper.js";
import {
  ProviderAdapterExecutor,
  providerAdapterExecutor,
} from "../provider/adapters/provider-adapter-executor.js";
import type { AdapterExecutionContext } from "../provider/adapters/provider-adapter.types.js";
import {
  providerRepository,
  type IProviderRepository,
} from "../provider/provider.repository.js";
import {
  orchestrationRepository,
  type IOrchestrationRepository,
} from "../orchestration/orchestration.repository.js";
import { buildBookingCorrelationReference } from "./booking.constants.js";
import {
  isProviderBookingEligible,
  providerSupportsQuote,
  validateSelectedService,
} from "./booking.eligibility.js";
import { mapBookingGetResponse, mapConfirmResponse } from "./booking.mapper.js";
import {
  classifyBookingExecutionError,
  resolveNormalizedBookingResult,
} from "./booking.provider-outcome.js";
import { hasMaterialCancellationPolicyChange } from "./booking.policy-freshness.js";
import {
  hasMaterialPriceChange,
  isQuoteStale,
  resolveQuoteTimestamp,
} from "./booking.quote-freshness.js";
import type { CancellationPolicySnapshot } from "../provider/contracts/cancellation-policy.js";
import { providerAdapterRegistry } from "../provider/adapters/provider-adapter-registry.js";
import {
  bookingRepository,
  type IBookingRepository,
} from "./booking.repository.js";
import type { QuoteSnapshot } from "./booking.types.js";

const CONFIRMABLE_STATUSES = new Set(["OPTION_READY"]);
const TERMINAL_BOOKING_STATUSES = new Set(["BOOKED", "FAILED", "UNKNOWN"]);

export class BookingService {
  constructor(
    private readonly deliveryRepo: IDeliveryRepository = deliveryRepository,
    private readonly providerRepo: IProviderRepository = providerRepository,
    private readonly orchestrationRepo: IOrchestrationRepository = orchestrationRepository,
    private readonly bookingRepo: IBookingRepository = bookingRepository,
    private readonly adapterExecutor: ProviderAdapterExecutor = providerAdapterExecutor,
  ) {}

  async confirm(input: {
    deliveryId: string;
    userId: string;
    role: UserRole;
    requestId: string;
    idempotencyKey?: string;
    requestHash: string;
    testHints?: AdapterExecutionContext["testHints"];
  }) {
    if (input.idempotencyKey) {
      const existing = await this.bookingRepo.findConfirmIdempotency(
        input.userId,
        input.idempotencyKey,
      );
      if (existing) {
        if (existing.requestHash !== input.requestHash) {
          throw new AppError("Idempotency key reused with a different request.", {
            statusCode: 409,
            code: ErrorCodes.IDEMPOTENCY_CONFLICT,
          });
        }
        if (existing.deliveryId !== input.deliveryId) {
          throw new AppError("Idempotency key reused with a different request.", {
            statusCode: 409,
            code: ErrorCodes.IDEMPOTENCY_CONFLICT,
          });
        }
        return { success: true as const, data: existing.responsePayload };
      }
    }

    const deliveryRecord = await this.loadAuthorizedDelivery(
      input.deliveryId,
      input.userId,
      input.role,
    );
    const delivery = toDeliveryDetailDto(deliveryRecord);

    const existingBooked = await this.bookingRepo.findLatestBookedByDeliveryId(
      input.deliveryId,
    );
    if (delivery.status === "BOOKED" || existingBooked) {
      const booking =
        existingBooked ??
        (await this.bookingRepo.findLatestBookedByDeliveryId(input.deliveryId));
      if (!booking) {
        throw new AppError("Booking not found.", {
          statusCode: 404,
          code: ErrorCodes.BOOKING_NOT_FOUND,
        });
      }
      const response = mapConfirmResponse(input.role, delivery, booking);
      await this.persistIdempotencyIfNeeded(input, response);
      return { success: true as const, data: response };
    }

    const latestBooking = await this.bookingRepo.findLatestByDeliveryId(
      input.deliveryId,
    );
    if (latestBooking?.status === "UNKNOWN") {
      throw new AppError(
        "Booking outcome is unknown. Reconciliation is required before retrying.",
        {
          statusCode: 409,
          code: ErrorCodes.PROVIDER_BOOKING_RECONCILIATION_REQUIRED,
        },
      );
    }

    const activeBooking = await this.bookingRepo.findActiveByDeliveryId(
      input.deliveryId,
    );
    if (activeBooking || delivery.status === "BOOKING") {
      throw new AppError("Booking is already in progress.", {
        statusCode: 409,
        code: ErrorCodes.BOOKING_IN_PROGRESS,
      });
    }

    if (!CONFIRMABLE_STATUSES.has(delivery.status)) {
      throw new AppError("Delivery is not ready for booking confirmation.", {
        statusCode: 422,
        code: ErrorCodes.BOOKING_NOT_ALLOWED,
      });
    }

    const orchestration =
      await this.orchestrationRepo.findLatestCompletedByDeliveryId(
        input.deliveryId,
      );
    const selectedOption = orchestration?.selectedOption;
    if (!orchestration || !selectedOption) {
      throw new AppError("No selected orchestration option found for delivery.", {
        statusCode: 422,
        code: ErrorCodes.BOOKING_NOT_ALLOWED,
      });
    }

    if (orchestration.deliveryId !== input.deliveryId) {
      throw new AppError("Selected option does not belong to delivery.", {
        statusCode: 422,
        code: ErrorCodes.BOOKING_NOT_ALLOWED,
      });
    }

    const provider = await this.providerRepo.findById(selectedOption.providerId);
    if (!provider) {
      throw new AppError("Selected provider is no longer available.", {
        statusCode: 422,
        code: ErrorCodes.PROVIDER_BOOKING_UNAVAILABLE,
      });
    }

    if (!isProviderBookingEligible(provider)) {
      throw new AppError("Selected provider is not eligible for booking.", {
        statusCode: 422,
        code: ErrorCodes.PROVIDER_BOOKING_UNAVAILABLE,
      });
    }

    const serviceValidation = validateSelectedService({
      provider,
      providerServiceId: selectedOption.providerServiceId,
      providerServiceCode: selectedOption.providerServiceCode,
    });
    if (!serviceValidation.valid) {
      throw new AppError("Selected provider service is no longer available.", {
        statusCode: 422,
        code: ErrorCodes.PROVIDER_BOOKING_UNAVAILABLE,
      });
    }

    let quoteSnapshot = selectedOption.quoteSnapshot as QuoteSnapshot;
    if (quoteSnapshot.amount == null || !quoteSnapshot.currency) {
      throw new AppError("Selected option quote snapshot is invalid.", {
        statusCode: 422,
        code: ErrorCodes.BOOKING_NOT_ALLOWED,
      });
    }

    const quoteTimestamp = resolveQuoteTimestamp({
      quoteSnapshot,
      orchestrationCompletedAt: orchestration.completedAt,
      optionCreatedAt: selectedOption.createdAt,
    });

    if (
      isQuoteStale(quoteTimestamp, DEFAULT_BOOKING_QUOTE_MAX_AGE_SECONDS) &&
      providerSupportsQuote(provider)
    ) {
      const refreshed = await this.requote({
        delivery,
        providerCode: selectedOption.providerCode,
        serviceCode: serviceValidation.serviceCode,
        requestId: input.requestId,
        testHints: input.testHints,
      });
      if (!refreshed.available || refreshed.amount == null) {
        throw new AppError("Provider quote is no longer available.", {
          statusCode: 422,
          code: ErrorCodes.BOOKING_OPTION_STALE,
        });
      }
      if (
        hasMaterialPriceChange({
          originalAmount: quoteSnapshot.amount,
          newAmount: refreshed.amount.amount,
          tolerancePercent: DEFAULT_BOOKING_PRICE_TOLERANCE_PERCENT,
        })
      ) {
        throw new AppError(
          "The selected option price has changed. Re-orchestrate and confirm again.",
          {
            statusCode: 409,
            code: ErrorCodes.BOOKING_OPTION_CHANGED,
          },
        );
      }
      quoteSnapshot = {
        amount: refreshed.amount.amount,
        currency: refreshed.amount.currency,
        providerQuoteId: refreshed.providerQuoteId,
        quotedAt: refreshed.quotedAt ?? new Date().toISOString(),
      };
    }

    const policySnapshot = selectedOption.cancellationPolicySnapshot as
      | CancellationPolicySnapshot
      | null;
    if (policySnapshot?.policyKnown) {
      const adapter = providerAdapterRegistry.resolve(selectedOption.providerCode);
      if (adapter?.supportsOperation("getCancellationPolicy")) {
        const refreshedPolicy = await this.adapterExecutor.execute({
          providerCode: selectedOption.providerCode,
          operation: "getCancellationPolicy",
          payload: {
            deliveryId: delivery.id,
            deliveryReference: delivery.reference,
            serviceCode: serviceValidation.serviceCode ?? undefined,
            providerQuoteId: quoteSnapshot.providerQuoteId ?? null,
          },
          requestId: input.requestId,
          requireReady: true,
          testHints: input.testHints,
        });
        if (
          hasMaterialCancellationPolicyChange({
            original: policySnapshot,
            refreshed: refreshedPolicy,
          })
        ) {
          logger.warn(
            {
              requestId: input.requestId,
              deliveryId: input.deliveryId,
              providerCode: selectedOption.providerCode,
            },
            "booking_cancellation_policy_changed",
          );
          throw new AppError(
            "The selected option cancellation policy has changed. Re-orchestrate and confirm again.",
            {
              statusCode: 409,
              code: ErrorCodes.BOOKING_OPTION_CHANGED,
            },
          );
        }
      }
    }

    const attemptNumber = await this.bookingRepo.getNextAttemptNumber(
      input.deliveryId,
    );
    const correlationReference = buildBookingCorrelationReference(
      delivery.reference,
      attemptNumber,
    );

    const bookingAttempt = await this.deliveryRepo.withTransaction(async (tx) => {
      const transitioned = await this.deliveryRepo.transitionStatus(
        {
          deliveryId: input.deliveryId,
          expectedFromStatuses: ["OPTION_READY"],
          toStatus: "BOOKING",
          source: "BOOKING",
          reason: "Customer confirmed delivery option",
          metadata: {
            orchestrationOptionId: selectedOption.id,
            providerCode: selectedOption.providerCode,
            attemptNumber,
          },
        },
        tx,
      );
      if (!transitioned) {
        throw new AppError("Delivery state changed before booking could start.", {
          statusCode: 409,
          code: ErrorCodes.BOOKING_IN_PROGRESS,
        });
      }

      return this.bookingRepo.createBookingAttempt(
        {
          deliveryId: input.deliveryId,
          attemptNumber,
          orchestrationRequestId: orchestration.id,
          orchestrationOptionId: selectedOption.id,
          providerId: selectedOption.providerId,
          providerServiceId: serviceValidation.serviceId,
          providerCode: selectedOption.providerCode,
          providerServiceCode: serviceValidation.serviceCode,
          correlationReference,
          quotedAmount: quoteSnapshot.amount,
          quotedCurrency: quoteSnapshot.currency,
          providerQuoteId: quoteSnapshot.providerQuoteId ?? null,
          quoteSnapshot,
          requestId: input.requestId,
        },
        tx,
      );
    });

    logger.info(
      {
        requestId: input.requestId,
        deliveryId: input.deliveryId,
        bookingId: bookingAttempt.id,
        providerCode: selectedOption.providerCode,
        correlationReference,
      },
      "booking_started",
    );

    let resolved;
    try {
      const bookingRequest = toBookingRequest(delivery, {
        serviceCode: serviceValidation.serviceCode ?? undefined,
        providerQuoteId: quoteSnapshot.providerQuoteId ?? null,
        idempotencyKey: correlationReference,
      });

      logger.info(
        {
          requestId: input.requestId,
          bookingId: bookingAttempt.id,
          providerCode: selectedOption.providerCode,
        },
        "booking_provider_called",
      );

      const adapterResult = await this.adapterExecutor.execute({
        providerCode: selectedOption.providerCode,
        operation: "createBooking",
        payload: bookingRequest,
        requestId: input.requestId,
        requireReady: true,
        testHints: input.testHints,
      });

      resolved = resolveNormalizedBookingResult(adapterResult);
    } catch (error) {
      resolved = classifyBookingExecutionError(error);
    }

    const finalized = await this.finalizeBookingAttempt({
      deliveryId: input.deliveryId,
      booking: bookingAttempt,
      resolved,
      requestId: input.requestId,
    });

    const refreshedDelivery = await this.deliveryRepo.findById(input.deliveryId);
    const response = mapConfirmResponse(
      input.role,
      {
        id: delivery.id,
        reference: delivery.reference,
        status: refreshedDelivery?.status ?? delivery.status,
      },
      finalized,
    );

    await this.persistIdempotencyIfNeeded(input, response);

    if (finalized.status === "FAILED") {
      throw new AppError(finalized.failureMessage ?? "Provider booking failed.", {
        statusCode: 422,
        code:
          (finalized.failureCode as typeof ErrorCodes.BOOKING_FAILED | null) ??
          ErrorCodes.BOOKING_FAILED,
      });
    }

    if (finalized.status === "UNKNOWN") {
      throw new AppError(
        "Provider booking outcome is unknown. Reconciliation is required.",
        {
          statusCode: 503,
          code: ErrorCodes.BOOKING_UNKNOWN,
        },
      );
    }

    return { success: true as const, data: response };
  }

  async getBooking(input: {
    deliveryId: string;
    userId: string;
    role: UserRole;
  }) {
    const deliveryRecord = await this.loadAuthorizedDelivery(
      input.deliveryId,
      input.userId,
      input.role,
    );
    const booking = await this.bookingRepo.findLatestByDeliveryId(input.deliveryId);
    if (!booking) {
      throw new AppError("Booking not found.", {
        statusCode: 404,
        code: ErrorCodes.BOOKING_NOT_FOUND,
      });
    }

    return mapBookingGetResponse(
      input.role,
      {
        id: deliveryRecord.id,
        reference: deliveryRecord.reference,
        status: deliveryRecord.status,
      },
      booking,
    );
  }

  private async requote(input: {
    delivery: ReturnType<typeof toDeliveryDetailDto>;
    providerCode: string;
    serviceCode: string | null;
    requestId: string;
    testHints?: AdapterExecutionContext["testHints"];
  }) {
    const quoteRequest = toQuoteRequest(input.delivery, {
      serviceCode: input.serviceCode ?? undefined,
    });
    return this.adapterExecutor.execute({
      providerCode: input.providerCode,
      operation: "getQuote",
      payload: quoteRequest,
      requestId: input.requestId,
      requireReady: true,
      testHints: input.testHints,
    });
  }

  private async finalizeBookingAttempt(input: {
    deliveryId: string;
    booking: Awaited<ReturnType<IBookingRepository["createBookingAttempt"]>>;
    resolved: ReturnType<typeof resolveNormalizedBookingResult>;
    requestId: string;
  }) {
    const now = new Date();
    const status =
      input.resolved.outcome === "BOOKED"
        ? "BOOKED"
        : input.resolved.outcome === "UNKNOWN"
          ? "UNKNOWN"
          : "FAILED";

    const deliveryTargetStatus =
      status === "BOOKED" ? "BOOKED" : status === "FAILED" ? "FAILED" : "BOOKING";

    const eventReason =
      status === "BOOKED"
        ? "Provider booking confirmed"
        : status === "FAILED"
          ? "Provider booking failed"
          : "Provider booking outcome unknown";

    const finalized = await this.deliveryRepo.withTransaction(async (tx) => {
      const booking = await this.bookingRepo.finalizeBooking(
        {
          bookingId: input.booking.id,
          status,
          providerOrderId: input.resolved.providerOrderId,
          providerReference: input.resolved.providerReference,
          providerStatus: input.resolved.providerStatus,
          bookedAmount: input.resolved.bookedAmount,
          bookedCurrency: input.resolved.bookedCurrency,
          unknownOutcome: status === "UNKNOWN",
          failureCode: input.resolved.failureCode,
          failureMessage: input.resolved.failureMessage,
          bookedAt: input.resolved.bookedAt ?? (status === "BOOKED" ? now : null),
          failedAt: status === "FAILED" ? now : null,
        },
        tx,
      );

      if (deliveryTargetStatus !== "BOOKING") {
        await this.deliveryRepo.transitionStatus(
          {
            deliveryId: input.deliveryId,
            expectedFromStatuses: ["BOOKING"],
            toStatus: deliveryTargetStatus,
            source: "BOOKING",
            reason: eventReason,
            metadata: {
              bookingId: booking.id,
              providerCode: booking.providerCode,
              providerOrderId: booking.providerOrderId,
              failureCode: booking.failureCode,
              unknownOutcome: booking.unknownOutcome,
            },
          },
          tx,
        );
      }

      return booking;
    });

    logger.info(
      {
        requestId: input.requestId,
        deliveryId: input.deliveryId,
        bookingId: finalized.id,
        providerCode: finalized.providerCode,
        status: finalized.status,
        providerOrderId: finalized.providerOrderId,
      },
      status === "BOOKED"
        ? "booking_provider_succeeded"
        : status === "FAILED"
          ? "booking_provider_failed"
          : "booking_provider_unknown",
    );

    return finalized;
  }

  private async loadAuthorizedDelivery(
    deliveryId: string,
    userId: string,
    role: UserRole,
  ) {
    const delivery =
      role === "ADMIN"
        ? await this.deliveryRepo.findById(deliveryId)
        : await this.deliveryRepo.findByIdForCustomer(deliveryId, userId);
    if (!delivery) {
      throw new AppError("Delivery not found.", {
        statusCode: 404,
        code: ErrorCodes.DELIVERY_NOT_FOUND,
      });
    }
    return delivery;
  }

  private async persistIdempotencyIfNeeded(
    input: {
      userId: string;
      deliveryId: string;
      idempotencyKey?: string;
      requestHash: string;
    },
    response: ReturnType<typeof mapConfirmResponse>,
  ) {
    if (!input.idempotencyKey) {
      return;
    }
    try {
      await this.bookingRepo.saveConfirmIdempotency({
        customerId: input.userId,
        key: input.idempotencyKey,
        requestHash: input.requestHash,
        deliveryId: input.deliveryId,
        responsePayload: response,
      });
    } catch {
      const existing = await this.bookingRepo.findConfirmIdempotency(
        input.userId,
        input.idempotencyKey,
      );
      if (
        existing &&
        existing.requestHash === input.requestHash &&
        existing.deliveryId === input.deliveryId
      ) {
        return;
      }
      throw new AppError("Idempotency key reused with a different request.", {
        statusCode: 409,
        code: ErrorCodes.IDEMPOTENCY_CONFLICT,
      });
    }
  }
}

export const bookingService = new BookingService();

// Reference terminal statuses for tests/documentation.
export { CONFIRMABLE_STATUSES, TERMINAL_BOOKING_STATUSES };
