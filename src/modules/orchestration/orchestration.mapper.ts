import type { UserRole } from "@prisma/client";
import type {
  AdminOrchestrationResultDto,
  CustomerOrchestrationResultDto,
  CustomerSelectedOptionDto,
  OrchestrationRequestDto,
} from "./orchestration.types.js";

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
  };
  const availability = option.availabilitySnapshot as {
    known?: boolean;
    available?: boolean;
    availableDriverCount?: number | null;
    reason?: string | null;
  } | null;
  const eta = option.etaSnapshot as { estimatedDeliveryAt?: string | null } | null;

  return {
    providerCode: option.providerCode,
    serviceCode: option.providerServiceCode,
    quote: {
      amount: quote.amount ?? 0,
      currency: quote.currency ?? "INR",
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
  };
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
  const customer = toCustomerOrchestrationResult(
    deliveryId,
    deliveryStatus,
    request,
  );
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
