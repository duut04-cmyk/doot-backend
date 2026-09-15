import { ErrorCodes } from "../../core/errors/error-codes.js";
import type {
  CancellationOutcome,
  NormalizedCancellationResult,
} from "../provider/contracts/cancellation.js";
import { ProviderAdapterError } from "../provider/contracts/provider-error.js";

export type ResolvedCancellationOutcome = {
  outcome: CancellationOutcome;
  providerCancellationReference: string | null;
  cancelledAt: Date | null;
  failureCode: string | null;
  failureMessage: string | null;
};

export function resolveCancellationResult(
  result: NormalizedCancellationResult,
): ResolvedCancellationOutcome {
  const outcome: CancellationOutcome =
    result.outcome ??
    (result.success ? "CANCELLED" : "REJECTED");

  return {
    outcome,
    providerCancellationReference: result.providerCancellationId,
    cancelledAt: result.cancelledAt ? new Date(result.cancelledAt) : null,
    failureCode:
      outcome === "REJECTED"
        ? ErrorCodes.PROVIDER_CANCELLATION_REJECTED
        : null,
    failureMessage: outcome === "REJECTED" ? result.reason : null,
  };
}

export function classifyCancellationError(
  error: unknown,
): ResolvedCancellationOutcome {
  if (error instanceof ProviderAdapterError) {
    const unknown = new Set([
      "PROVIDER_TIMEOUT",
      "PROVIDER_SERVICE_UNAVAILABLE",
      "PROVIDER_UNKNOWN_ERROR",
    ]);
    if (unknown.has(error.category)) {
      return {
        outcome: "UNKNOWN",
        providerCancellationReference: null,
        cancelledAt: null,
        failureCode: ErrorCodes.CANCELLATION_UNKNOWN,
        failureMessage: error.safeMessage,
      };
    }
    return {
      outcome: "REJECTED",
      providerCancellationReference: null,
      cancelledAt: null,
      failureCode: ErrorCodes.PROVIDER_CANCELLATION_REJECTED,
      failureMessage: error.safeMessage,
    };
  }
  return {
    outcome: "UNKNOWN",
    providerCancellationReference: null,
    cancelledAt: null,
    failureCode: ErrorCodes.CANCELLATION_UNKNOWN,
    failureMessage: "Cancellation outcome could not be determined.",
  };
}
