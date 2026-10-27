import type { UserRole } from "@prisma/client";
import type { CancellationPolicy } from "../provider/contracts/cancellation-policy.js";
import type {
  AdminOrchestrationListItemDto,
  AdminOrchestrationResultDto,
  AdminOrchestrationRunDetailDto,
  CustomerOrchestrationResultDto,
  CustomerSelectedOptionDto,
  OrchestrationEvaluationDto,
  OrchestrationListAggregate,
  OrchestrationListBookingSnapshot,
  OrchestrationListDeliverySnapshot,
  OrchestrationRequestDto,
} from "./orchestration.types.js";

function mapCancellationPolicy(snapshot: unknown): CancellationPolicy | null {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }
  const policy = snapshot as CancellationPolicy;
  if (typeof policy.policyKnown !== "boolean") {
    return null;
  }
  return policy;
}

function mapSelectedOption(
  request: OrchestrationRequestDto,
): CustomerSelectedOptionDto | null {
  const option = request.selectedOption;
  if (!option) {
    return null;
  }

  const quote = option.quoteSnapshot as {
    amount?: number;
    currency?: string;
    customerPayableAmount?: number;
    platformFeeAmount?: number;
    gstAmount?: number;
  };
  const availability = option.availabilitySnapshot as {
    known?: boolean;
    available?: boolean;
    availableDriverCount?: number | null;
    reason?: string | null;
  } | null;
  const eta = option.etaSnapshot as { estimatedDeliveryAt?: string | null } | null;
  const cancellationPolicy = mapCancellationPolicy(
    option.cancellationPolicySnapshot,
  ) ?? {
    supported: false,
    allowedBeforePickup: false,
    allowedAfterPickup: false,
    fee: { type: "UNKNOWN" as const },
    conditions: [],
    policyKnown: false,
    source: "UNKNOWN" as const,
  };

  return {
    providerCode: option.providerCode,
    serviceCode: option.providerServiceCode,
    quote: {
      amount: quote.amount ?? 0,
      currency: quote.currency ?? "INR",
      ...(quote.customerPayableAmount != null
        ? {
            customerPayableAmount: quote.customerPayableAmount,
            platformFeeAmount: quote.platformFeeAmount,
            gstAmount: quote.gstAmount,
          }
        : {}),
    },
    estimatedDeliveryAt: eta?.estimatedDeliveryAt ?? null,
    availability: availability
      ? {
          known: availability.known ?? false,
          ...(availability.known
            ? {
                available: availability.available,
                availableDriverCount: availability.availableDriverCount,
                reason: availability.reason,
              }
            : {}),
        }
      : { known: false },
    selectionReason: option.selectionReason,
    cancellationPolicy,
  };
}

function extractEvaluationCancellationPolicy(
  evaluation: OrchestrationRequestDto["evaluations"][number],
): CancellationPolicy | null {
  const normalized = evaluation.normalizedResult as {
    cancellationPolicy?: CancellationPolicy;
  } | null;
  return normalized?.cancellationPolicy ?? null;
}

export function toCustomerOrchestrationResult(
  deliveryId: string,
  deliveryStatus: string,
  request: OrchestrationRequestDto,
): CustomerOrchestrationResultDto {
  return {
    deliveryId,
    status: deliveryStatus,
    orchestration: {
      id: request.id,
      attemptNumber: request.attemptNumber,
      completedAt: request.completedAt?.toISOString() ?? null,
      selectedOption: mapSelectedOption(request),
    },
  };
}

export function toAdminOrchestrationResult(
  deliveryId: string,
  deliveryStatus: string,
  request: OrchestrationRequestDto,
): AdminOrchestrationResultDto {
  const customer = toCustomerOrchestrationResult(deliveryId, deliveryStatus, request);
  return {
    ...customer,
    orchestration: {
      ...customer.orchestration,
      status: request.status,
      failureReason: request.failureReason,
      evaluations: request.evaluations.map((evaluation) => ({
        id: evaluation.id,
        providerCode: evaluation.providerCode,
        providerServiceCode: evaluation.providerServiceCode,
        status: evaluation.status,
        serviceable: evaluation.serviceable,
        availabilityKnown: evaluation.availabilityKnown,
        available: evaluation.available,
        availableDriverCount: evaluation.availableDriverCount,
        quoteAvailable: evaluation.quoteAvailable,
        quoteAmount: evaluation.quoteAmount,
        quoteCurrency: evaluation.quoteCurrency,
        estimatedDeliveryAt: evaluation.estimatedDeliveryAt?.toISOString() ?? null,
        exclusionReasons: evaluation.exclusionReasons,
        eligibilityReasons: evaluation.eligibilityReasons,
        warnings: evaluation.warnings,
        score: evaluation.score,
        scoreBreakdown: evaluation.scoreBreakdown,
        errorCategory: evaluation.errorCategory,
        cancellationPolicy: extractEvaluationCancellationPolicy(evaluation),
      })),
    },
  };
}

export function mapOrchestrationResponse(
  role: UserRole,
  deliveryId: string,
  deliveryStatus: string,
  request: OrchestrationRequestDto,
): CustomerOrchestrationResultDto | AdminOrchestrationResultDto {
  if (role === "ADMIN") {
    return toAdminOrchestrationResult(deliveryId, deliveryStatus, request);
  }
  return toCustomerOrchestrationResult(deliveryId, deliveryStatus, request);
}

export function countEligibleEvaluations(
  evaluations: Pick<OrchestrationEvaluationDto, "status">[],
): number {
  return evaluations.filter((evaluation) => evaluation.status === "ELIGIBLE").length;
}

export function countAvailableOptions(
  evaluations: Pick<
    OrchestrationEvaluationDto,
    "status" | "available" | "quoteAvailable"
  >[],
): number {
  return evaluations.filter(
    (evaluation) =>
      evaluation.status === "ELIGIBLE" &&
      evaluation.available !== false &&
      evaluation.quoteAvailable !== false,
  ).length;
}

export function toAdminOrchestrationRunDetail(
  request: OrchestrationRequestDto,
  delivery: OrchestrationListDeliverySnapshot | null,
  booking: OrchestrationListBookingSnapshot | null,
): AdminOrchestrationRunDetailDto {
  const deliveryId = delivery?.id ?? request.deliveryId;
  const deliveryStatus = delivery?.status ?? "CREATED";
  const base = toAdminOrchestrationResult(deliveryId, deliveryStatus, request);
  const durationMs =
    request.completedAt != null
      ? request.completedAt.getTime() - request.startedAt.getTime()
      : null;

  return {
    ...base,
    durationMs,
    delivery: {
      reference: delivery?.reference ?? "",
      pickupAddressText: delivery?.pickupAddressText ?? "",
      dropAddressText: delivery?.dropAddressText ?? "",
    },
    booking,
    orchestration: {
      ...base.orchestration,
      startedAt: request.startedAt.toISOString(),
      createdAt: request.createdAt.toISOString(),
    },
  };
}

export function toAdminOrchestrationListItem(
  aggregate: OrchestrationListAggregate,
): AdminOrchestrationListItemDto {
  const { request, delivery, booking } = aggregate;
  const durationMs =
    request.completedAt != null
      ? request.completedAt.getTime() - request.startedAt.getTime()
      : null;

  return {
    orchestrationId: request.id,
    attemptNumber: request.attemptNumber,
    orchestrationStatus: request.status,
    failureReason: request.failureReason,
    startedAt: request.startedAt.toISOString(),
    completedAt: request.completedAt?.toISOString() ?? null,
    createdAt: request.createdAt.toISOString(),
    durationMs,
    deliveryId: delivery?.id ?? request.deliveryId,
    deliveryReference: delivery?.reference ?? "",
    deliveryStatus: delivery?.status ?? "CREATED",
    pickupAddressText: delivery?.pickupAddressText ?? "",
    dropAddressText: delivery?.dropAddressText ?? "",
    evaluationCount: request.evaluations.length,
    eligibleCount: countEligibleEvaluations(request.evaluations),
    availableOptionCount: countAvailableOptions(request.evaluations),
    selectedProviderCode: request.selectedOption?.providerCode ?? null,
    selectedServiceCode: request.selectedOption?.providerServiceCode ?? null,
    selectedScore: request.selectedOption?.score ?? null,
    selectionReason: request.selectedOption?.selectionReason ?? null,
    booking,
  };
}
