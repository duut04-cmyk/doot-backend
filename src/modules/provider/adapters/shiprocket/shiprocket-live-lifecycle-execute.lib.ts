import type { ProviderEnvironment, UserRole } from "@prisma/client";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "../../../../core/errors/app-error.js";
import { ErrorCodes } from "../../../../core/errors/error-codes.js";
import type { BookingService } from "../../../booking/booking.service.js";
import { hashConfirmRequest } from "../../../booking/booking.schema.js";
import type { QuoteSnapshot } from "../../../booking/booking.types.js";
import { resolveShiprocketProviderMetadata } from "../../../booking/booking.quote-snapshot.js";
import {
  validateSelectedService,
  isProviderBookingEligible,
} from "../../../booking/booking.eligibility.js";
import type { IBookingRepository } from "../../../booking/booking.repository.js";
import type { CancellationService } from "../../../cancellation/cancellation.service.js";
import { hashCancelRequest } from "../../../cancellation/cancellation.schema.js";
import type { ICancellationRepository } from "../../../cancellation/cancellation.repository.js";
import {
  deliveryRepository,
  toDeliveryDetailDto,
  type IDeliveryRepository,
} from "../../../delivery/delivery.repository.js";
import type { IOrchestrationRepository } from "../../../orchestration/orchestration.repository.js";
import type { IPaymentRepository } from "../../../payment/payment.repository.js";
import type { IProviderRepository } from "../../../provider/provider.repository.js";
import { toBookingRequest } from "../delivery-provider.mapper.js";
import type { ProviderAdapterExecutor } from "../provider-adapter-executor.js";
import type { NormalizedBookingResult } from "../../contracts/booking.js";
import type { NormalizedTrackingResult } from "../../contracts/tracking.js";
import {
  buildShiprocketAdhocOrderPayload,
  isStrictLiveShiprocketBooking,
} from "./shiprocket-booking-payload.js";
import {
  getShiprocketLiveLifecycleArtifactRecorder,
  type ShiprocketLiveLifecycleDbSnapshot,
} from "./shiprocket-live-lifecycle-artifacts.js";
import {
  assertShiprocketProductionBaseUrl,
  ShiprocketLiveLifecycleGuardError,
} from "./shiprocket-live-lifecycle.guards.js";
import {
  assertLiveCancellationGate,
  clearShiprocketLiveLifecycleArtifactRun,
  prepareShiprocketLiveLifecycleArtifactRun,
  runShiprocketLiveLifecyclePreflight,
  type ShiprocketLiveLifecyclePreflightInput,
} from "./shiprocket-live-lifecycle-runner.lib.js";
import { SHIPROCKET_PROVIDER_CODE } from "./shiprocket.constants.js";
import { isValidShiprocketAwbCode } from "./shiprocket-order-show.parse.js";
import { requireShiprocketCourierId } from "./shiprocket-metadata.util.js";
import { ShiprocketLiveLifecycleExecuteError } from "./shiprocket-live-lifecycle.errors.js";
import { assertShiprocketLiveProviderIdentity } from "./shiprocket-live-provider-identity.js";

export { ShiprocketLiveLifecycleExecuteError } from "./shiprocket-live-lifecycle.errors.js";

export type ShiprocketLiveLifecycleExecuteDeps = {
  bookingService: BookingService;
  cancellationService: CancellationService;
  adapterExecutor: ProviderAdapterExecutor;
  deliveryRepo?: IDeliveryRepository;
  bookingRepo: IBookingRepository;
  cancellationRepo: ICancellationRepository;
  orchestrationRepo: IOrchestrationRepository;
  paymentRepo: IPaymentRepository;
  providerRepo: IProviderRepository;
};

export type ShiprocketLiveLifecycleExecuteInput = {
  dryRun: boolean;
  runId: string;
  deliveryId: string;
  deliveryReference: string;
  confirmLiveHost?: string;
  confirmCancel?: string;
  shiprocketEnabled: boolean;
  shiprocketBookingEnabled: boolean;
  pickupLocation: string | undefined;
  provider: {
    code: string;
    environment: ProviderEnvironment;
    baseUrl: string;
    providerId: string;
  };
  operatorRole?: UserRole;
  requestId?: string;
  reportsRoot?: string;
  skipCancellation?: boolean;
};

export type ShiprocketLiveLifecyclePhaseRecord = {
  phase: string;
  ok: boolean;
  detail?: string;
};

export type ShiprocketLiveLifecycleExecuteResult = {
  ok: boolean;
  dryRun: boolean;
  runId: string;
  runDirectory: string | null;
  productionBaseUrl: string;
  phases: ShiprocketLiveLifecyclePhaseRecord[];
  deliveryId: string;
  deliveryReference: string;
  providerOrderId?: string | null;
  awbCode?: string | null;
  stopPhase?: string;
  stopCode?: string;
};

const LIVE_EXECUTE_REASON_CODE = "OTHER" as const;
const CONFIRMABLE_FOR_LIVE_EXECUTE = new Set(["OPTION_READY"]);

function liveExecuteIdempotencyKey(runId: string, suffix: string): string {
  return createHash("sha256")
    .update(`shiprocket-live-lifecycle:${runId}:${suffix}`)
    .digest("hex")
    .slice(0, 32);
}

export async function resolveLiveLifecycleExecuteContext(input: {
  deps: ShiprocketLiveLifecycleExecuteDeps;
  deliveryId: string;
  expectedReference: string;
  resolvedProviderId: string;
}): Promise<{
  customerId: string;
  bookingRequest: ReturnType<typeof toBookingRequest>;
  providerCode: string;
}> {
  const deliveryRepo = input.deps.deliveryRepo ?? deliveryRepository;
  const record = await deliveryRepo.findById(input.deliveryId);
  if (!record) {
    throw new ShiprocketLiveLifecycleExecuteError(
      "Delivery not found.",
      "validate_delivery",
      "DELIVERY_NOT_FOUND",
    );
  }

  const reference = record.reference.trim();
  if (reference !== input.expectedReference.trim()) {
    throw new ShiprocketLiveLifecycleExecuteError(
      "Delivery reference does not match --delivery-reference.",
      "validate_delivery",
      "DELIVERY_REFERENCE_MISMATCH",
    );
  }

  if (record.status === "BOOKED") {
    throw new ShiprocketLiveLifecycleExecuteError(
      "Delivery is already booked. Live lifecycle execute will not create another order.",
      "validate_delivery",
      "ALREADY_BOOKED",
    );
  }

  if (!CONFIRMABLE_FOR_LIVE_EXECUTE.has(record.status)) {
    throw new ShiprocketLiveLifecycleExecuteError(
      `Delivery status must be OPTION_READY before live execute (current: ${record.status}).`,
      "validate_delivery",
      "DELIVERY_NOT_CONFIRMABLE",
    );
  }

  const payment = await input.deps.paymentRepo.findByDeliveryId(input.deliveryId);
  if (!payment || payment.status !== "PAID") {
    throw new ShiprocketLiveLifecycleExecuteError(
      "Payment must be PAID before live booking execute.",
      "validate_payment",
      "PAYMENT_REQUIRED",
    );
  }

  const orchestration =
    await input.deps.orchestrationRepo.findLatestCompletedByDeliveryId(
      input.deliveryId,
    );
  const selectedOption = orchestration?.selectedOption;
  if (!orchestration || !selectedOption) {
    throw new ShiprocketLiveLifecycleExecuteError(
      "No selected orchestration option found for delivery.",
      "validate_orchestration",
      "ORCHESTRATION_MISSING",
    );
  }

  if (selectedOption.providerCode !== SHIPROCKET_PROVIDER_CODE) {
    throw new ShiprocketLiveLifecycleExecuteError(
      "Selected provider must be SHIPROCKET.",
      "validate_orchestration",
      "PROVIDER_NOT_SHIPROCKET",
    );
  }

  await assertShiprocketLiveProviderIdentity({
    providerRepo: input.deps.providerRepo,
    resolvedProviderId: input.resolvedProviderId,
    selectedOptionProviderId: selectedOption.providerId,
  });

  const provider = await input.deps.providerRepo.findById(selectedOption.providerId);
  if (!provider) {
    throw new ShiprocketLiveLifecycleExecuteError(
      "Selected provider is not available.",
      "validate_provider",
      "PROVIDER_NOT_FOUND",
    );
  }

  if (provider.environment !== "LIVE") {
    throw new ShiprocketLiveLifecycleExecuteError(
      "Provider.environment must be LIVE for this runner.",
      "validate_provider",
      "PROVIDER_NOT_LIVE",
    );
  }

  if (!isProviderBookingEligible(provider)) {
    throw new ShiprocketLiveLifecycleExecuteError(
      "Selected provider is not eligible for booking.",
      "validate_provider",
      "PROVIDER_NOT_ELIGIBLE",
    );
  }

  const serviceValidation = validateSelectedService({
    provider,
    providerServiceId: selectedOption.providerServiceId,
    providerServiceCode: selectedOption.providerServiceCode,
  });
  if (!serviceValidation.valid) {
    throw new ShiprocketLiveLifecycleExecuteError(
      "Selected provider service is not available.",
      "validate_provider",
      "PROVIDER_SERVICE_INVALID",
    );
  }

  const quoteSnapshot = selectedOption.quoteSnapshot as QuoteSnapshot;
  if (quoteSnapshot.amount == null || !quoteSnapshot.currency) {
    throw new ShiprocketLiveLifecycleExecuteError(
      "Selected option quote snapshot is invalid.",
      "validate_orchestration",
      "QUOTE_INVALID",
    );
  }

  const winnerEvaluation = orchestration.evaluations.find(
    (evaluation) => evaluation.id === selectedOption.evaluationId,
  );

  const delivery = toDeliveryDetailDto(record);
  const bookingRequest = toBookingRequest(delivery, {
    serviceCode: serviceValidation.serviceCode ?? undefined,
    providerQuoteId: quoteSnapshot.providerQuoteId ?? null,
    providerMetadata: resolveShiprocketProviderMetadata(
      quoteSnapshot,
      winnerEvaluation?.providerMetadata ?? null,
    ),
  });

  requireShiprocketCourierId({
    providerMetadata: bookingRequest.providerMetadata,
    providerQuoteId: bookingRequest.providerQuoteId,
  });

  buildShiprocketAdhocOrderPayload({
    request: bookingRequest,
    strictLive: isStrictLiveShiprocketBooking(provider.environment),
  });

  return {
    customerId: record.customerId,
    bookingRequest,
    providerCode: selectedOption.providerCode,
  };
}

export async function buildLiveLifecycleDbSnapshot(input: {
  deps: ShiprocketLiveLifecycleExecuteDeps;
  deliveryId: string;
  label: string;
}): Promise<ShiprocketLiveLifecycleDbSnapshot> {
  const deliveryRepo = input.deps.deliveryRepo ?? deliveryRepository;
  const delivery = await deliveryRepo.findById(input.deliveryId);
  const booking = await input.deps.bookingRepo.findLatestByDeliveryId(input.deliveryId);
  const cancellation = await input.deps.cancellationRepo.findLatestByDeliveryId(
    input.deliveryId,
  );

  const metadata = booking?.quoteSnapshot?.providerMetadata;
  const metadataKeys =
    metadata && typeof metadata === "object"
      ? Object.keys(metadata as Record<string, unknown>).sort()
      : [];

  return {
    label: input.label,
    timestamp: new Date().toISOString(),
    deliveryId: delivery?.id ?? input.deliveryId,
    deliveryStatus: delivery?.status ?? null,
    bookingId: booking?.id ?? null,
    bookingStatus: booking?.status ?? null,
    providerOrderId: booking?.providerOrderId ?? null,
    providerReference: booking?.providerReference ?? null,
    metadataKeys,
    cancellationId: cancellation?.id ?? null,
    cancellationStatus: cancellation?.status ?? null,
  };
}

async function recordDbSnapshot(
  deps: ShiprocketLiveLifecycleExecuteDeps,
  deliveryId: string,
  label: string,
): Promise<void> {
  const recorder = getShiprocketLiveLifecycleArtifactRecorder();
  if (!recorder) {
    return;
  }
  const snapshot = await buildLiveLifecycleDbSnapshot({ deps, deliveryId, label });
  await recorder.recordDbSnapshot(snapshot);
}

function assertBookingHasAwb(input: {
  bookingStatus: string;
  providerOrderId: string | null | undefined;
  metadata: Record<string, unknown> | null | undefined;
  phase: string;
}): { providerOrderId: string; awbCode: string } {
  if (input.bookingStatus === "UNKNOWN") {
    throw new ShiprocketLiveLifecycleExecuteError(
      "Booking outcome is UNKNOWN. Reconciliation is required before continuing.",
      input.phase,
      "BOOKING_UNKNOWN",
    );
  }
  if (input.bookingStatus !== "BOOKED") {
    throw new ShiprocketLiveLifecycleExecuteError(
      `Expected BOOKED booking status after confirm (got ${input.bookingStatus}).`,
      input.phase,
      "BOOKING_NOT_BOOKED",
    );
  }
  const providerOrderId = input.providerOrderId?.trim();
  if (!providerOrderId) {
    throw new ShiprocketLiveLifecycleExecuteError(
      "Provider order id is missing after booking.",
      input.phase,
      "MISSING_PROVIDER_ORDER_ID",
    );
  }
  const awbRaw = input.metadata?.shiprocketAwbCode;
  const awbCode = typeof awbRaw === "string" ? awbRaw.trim() : "";
  if (!isValidShiprocketAwbCode(awbCode)) {
    throw new ShiprocketLiveLifecycleExecuteError(
      "Shiprocket AWB is missing or invalid after booking.",
      input.phase,
      "MISSING_AWB",
    );
  }
  return { providerOrderId, awbCode };
}

function assertGetBookingHasAwb(
  result: NormalizedBookingResult,
  phase: string,
): { providerOrderId: string; awbCode: string; shipmentId: string | null } {
  const providerOrderId = result.providerBookingId?.trim();
  if (!providerOrderId) {
    throw new ShiprocketLiveLifecycleExecuteError(
      "getBooking did not return a provider order id.",
      phase,
      "ORDER_SHOW_INVALID",
    );
  }
  const awbRaw = result.metadata?.shiprocketAwbCode;
  const awbCode = typeof awbRaw === "string" ? awbRaw.trim() : "";
  if (result.outcome === "UNKNOWN" || !isValidShiprocketAwbCode(awbCode)) {
    throw new ShiprocketLiveLifecycleExecuteError(
      "getBooking did not confirm AWB / courier assignment.",
      phase,
      "MISSING_AWB",
    );
  }
  const shipmentRaw = result.metadata?.shiprocketShipmentId ?? result.providerReference;
  const shipmentId =
    typeof shipmentRaw === "string" && shipmentRaw.trim().length > 0
      ? shipmentRaw.trim()
      : null;
  return { providerOrderId, awbCode, shipmentId };
}

async function writeRunSummary(input: {
  runDirectory: string;
  summary: Record<string, unknown>;
}): Promise<void> {
  await writeFile(
    join(input.runDirectory, "run-summary.json"),
    JSON.stringify(input.summary, null, 2),
    "utf8",
  );
}

export async function runShiprocketLiveLifecycle(
  deps: ShiprocketLiveLifecycleExecuteDeps,
  input: ShiprocketLiveLifecycleExecuteInput,
): Promise<ShiprocketLiveLifecycleExecuteResult> {
  const phases: ShiprocketLiveLifecyclePhaseRecord[] = [];
  const requestId = input.requestId?.trim() || `live-lifecycle-${input.runId}`;
  const deliveryReference = input.deliveryReference.trim();

  assertShiprocketProductionBaseUrl(input.provider.baseUrl);

  const executeContext = await resolveLiveLifecycleExecuteContext({
    deps,
    deliveryId: input.deliveryId,
    expectedReference: deliveryReference,
    resolvedProviderId: input.provider.providerId,
  });

  const preflightInput: ShiprocketLiveLifecyclePreflightInput = {
    dryRun: input.dryRun,
    confirmLiveHost: input.confirmLiveHost,
    deliveryReference,
    shiprocketEnabled: input.shiprocketEnabled,
    shiprocketBookingEnabled: input.shiprocketBookingEnabled,
    pickupLocation: input.pickupLocation,
    provider: {
      code: input.provider.code,
      environment: input.provider.environment,
    },
    bookingRequest: executeContext.bookingRequest,
  };

  const preflight = runShiprocketLiveLifecyclePreflight(preflightInput);
  phases.push({ phase: "preflight", ok: true, detail: preflight.checks.join(",") });

  if (input.dryRun) {
    return {
      ok: true,
      dryRun: true,
      runId: input.runId,
      runDirectory: null,
      productionBaseUrl: preflight.productionBaseUrl,
      phases,
      deliveryId: input.deliveryId,
      deliveryReference,
    };
  }

  if (!input.confirmLiveHost?.trim()) {
    throw new ShiprocketLiveLifecycleGuardError(
      "Execute requires --confirm-live-host I_UNDERSTAND_LIVE_PRODUCTION",
    );
  }

  let runDirectory: string | null = null;
  try {
    await prepareShiprocketLiveLifecycleArtifactRun({
      runId: input.runId,
      reportsRoot: input.reportsRoot,
    });
    runDirectory = getShiprocketLiveLifecycleArtifactRecorder()?.runDirectory ?? null;
    phases.push({ phase: "artifact_recorder", ok: true });

    await recordDbSnapshot(deps, input.deliveryId, "before_book");
    phases.push({ phase: "db_before_book", ok: true });

    const operatorRole = input.operatorRole ?? "CUSTOMER";
    try {
      await deps.bookingService.confirm({
        deliveryId: input.deliveryId,
        userId: executeContext.customerId,
        role: operatorRole,
        requestId,
        idempotencyKey: liveExecuteIdempotencyKey(input.runId, "confirm"),
        requestHash: hashConfirmRequest(),
      });
    } catch (error) {
      if (error instanceof AppError && error.code === ErrorCodes.BOOKING_UNKNOWN) {
        throw new ShiprocketLiveLifecycleExecuteError(
          error.message,
          "book",
          "BOOKING_UNKNOWN",
        );
      }
      throw error;
    }

    const persistedBooking = await deps.bookingRepo.findLatestByDeliveryId(
      input.deliveryId,
    );
    const { providerOrderId, awbCode } = assertBookingHasAwb({
      bookingStatus: persistedBooking?.status ?? "MISSING",
      providerOrderId: persistedBooking?.providerOrderId,
      metadata: persistedBooking?.quoteSnapshot?.providerMetadata as
        Record<string, unknown> | undefined,
      phase: "book",
    });
    phases.push({
      phase: "book",
      ok: true,
      detail: `orderId=${providerOrderId} awb=${awbCode}`,
    });

    await recordDbSnapshot(deps, input.deliveryId, "after_book");
    phases.push({ phase: "db_after_book", ok: true });

    const orderShow = (await deps.adapterExecutor.execute({
      providerCode: SHIPROCKET_PROVIDER_CODE,
      operation: "getBooking",
      payload: { providerBookingId: providerOrderId },
      requestId: `${requestId}-order-show-1`,
      requireReady: true,
    })) as NormalizedBookingResult;

    const orderDetails = assertGetBookingHasAwb(orderShow, "order_show");
    phases.push({ phase: "order_show", ok: true });

    const tracking = (await deps.adapterExecutor.execute({
      providerCode: SHIPROCKET_PROVIDER_CODE,
      operation: "getTracking",
      payload: {
        providerBookingId: orderDetails.providerOrderId,
        providerAwbCode: orderDetails.awbCode,
        providerShipmentId: orderDetails.shipmentId ?? undefined,
      },
      requestId: `${requestId}-tracking-1`,
      requireReady: true,
    })) as NormalizedTrackingResult;
    phases.push({
      phase: "tracking",
      ok: true,
      detail: tracking.status,
    });

    if (!input.skipCancellation) {
      assertLiveCancellationGate({ confirmCancel: input.confirmCancel });
      phases.push({ phase: "cancel_gate", ok: true });

      try {
        await deps.cancellationService.cancel({
          deliveryId: input.deliveryId,
          userId: executeContext.customerId,
          role: operatorRole,
          requestId: `${requestId}-cancel`,
          reasonCode: LIVE_EXECUTE_REASON_CODE,
          reasonMessage: "Shiprocket live lifecycle operator verification",
          idempotencyKey: liveExecuteIdempotencyKey(input.runId, "cancel"),
          requestHash: hashCancelRequest({
            reasonCode: LIVE_EXECUTE_REASON_CODE,
            reasonMessage: "Shiprocket live lifecycle operator verification",
          }),
        });
      } catch (error) {
        if (error instanceof AppError) {
          if (error.code === ErrorCodes.PROVIDER_CANCELLATION_REJECTED) {
            throw new ShiprocketLiveLifecycleExecuteError(
              error.message,
              "cancel",
              "CANCEL_REJECTED",
            );
          }
          if (error.code === ErrorCodes.CANCELLATION_UNKNOWN) {
            throw new ShiprocketLiveLifecycleExecuteError(
              error.message,
              "cancel",
              "CANCEL_UNKNOWN",
            );
          }
        }
        throw error;
      }
      phases.push({ phase: "cancel", ok: true });

      await recordDbSnapshot(deps, input.deliveryId, "after_cancel");
      phases.push({ phase: "db_after_cancel", ok: true });

      const postOrderShow = (await deps.adapterExecutor.execute({
        providerCode: SHIPROCKET_PROVIDER_CODE,
        operation: "getBooking",
        payload: { providerBookingId: providerOrderId },
        requestId: `${requestId}-order-show-2`,
        requireReady: true,
      })) as NormalizedBookingResult;
      phases.push({
        phase: "post_cancel_order_show",
        ok: true,
        detail: postOrderShow.status ?? postOrderShow.outcome,
      });

      await deps.adapterExecutor.execute({
        providerCode: SHIPROCKET_PROVIDER_CODE,
        operation: "getTracking",
        payload: {
          providerBookingId: providerOrderId,
          providerAwbCode: orderDetails.awbCode,
          providerShipmentId: orderDetails.shipmentId ?? undefined,
        },
        requestId: `${requestId}-tracking-2`,
        requireReady: true,
      });
      phases.push({ phase: "post_cancel_tracking", ok: true });
    }

    if (runDirectory) {
      await writeRunSummary({
        runDirectory,
        summary: {
          ok: true,
          runId: input.runId,
          deliveryId: input.deliveryId,
          deliveryReference,
          providerOrderId,
          awbCode,
          phases,
          completedAt: new Date().toISOString(),
        },
      });
    }

    return {
      ok: true,
      dryRun: false,
      runId: input.runId,
      runDirectory,
      productionBaseUrl: preflight.productionBaseUrl,
      phases,
      deliveryId: input.deliveryId,
      deliveryReference,
      providerOrderId,
      awbCode,
    };
  } catch (error) {
    const stopPhase =
      error instanceof ShiprocketLiveLifecycleExecuteError ? error.phase : "execute";
    const stopCode =
      error instanceof ShiprocketLiveLifecycleExecuteError
        ? error.code
        : error instanceof ShiprocketLiveLifecycleGuardError
          ? "GUARD"
          : error instanceof AppError
            ? error.code
            : "EXECUTE_FAILED";

    if (runDirectory) {
      await writeRunSummary({
        runDirectory,
        summary: {
          ok: false,
          runId: input.runId,
          deliveryId: input.deliveryId,
          deliveryReference,
          phases,
          stopPhase,
          stopCode,
          message: error instanceof Error ? error.message : "Execute failed.",
          failedAt: new Date().toISOString(),
        },
      }).catch(() => undefined);
    }

    if (error instanceof ShiprocketLiveLifecycleExecuteError) {
      return {
        ok: false,
        dryRun: false,
        runId: input.runId,
        runDirectory,
        productionBaseUrl: preflight.productionBaseUrl,
        phases,
        deliveryId: input.deliveryId,
        deliveryReference,
        stopPhase,
        stopCode,
      };
    }
    throw error;
  } finally {
    clearShiprocketLiveLifecycleArtifactRun();
  }
}
