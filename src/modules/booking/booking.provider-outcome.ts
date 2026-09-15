import { ErrorCodes, type ErrorCode } from "../../core/errors/error-codes.js";
import { AppError } from "../../core/errors/app-error.js";
import type { BookingOutcome, NormalizedBookingResult } from "../provider/contracts/booking.js";
import { ProviderAdapterError } from "../provider/contracts/provider-error.js";

export type ResolvedBookingOutcome = {
  outcome: BookingOutcome;
  providerOrderId: string | null;
  providerReference: string | null;
  providerStatus: string | null;
  bookedAmount: number | null;
  bookedCurrency: string | null;
  bookedAt: Date | null;
  failureCode: ErrorCode | null;
  failureMessage: string | null;
};

export function resolveNormalizedBookingResult(
  result: NormalizedBookingResult,
): ResolvedBookingOutcome {
  const outcome =
    result.outcome ??
    (result.success ? ("BOOKED" as const) : ("FAILED" as const));

  return {
    outcome,
    providerOrderId: result.providerBookingId,
    providerReference: result.providerReference,
    providerStatus: result.status,
    bookedAmount: result.amount?.amount ?? null,
    bookedCurrency: result.amount?.currency ?? null,
    bookedAt: result.bookedAt ? new Date(result.bookedAt) : null,
    failureCode:
      outcome === "FAILED"
        ? ErrorCodes.PROVIDER_BOOKING_REJECTED
        : null,
    failureMessage: outcome === "FAILED" ? result.reason : null,
  };
}

export function classifyProviderAdapterError(
  error: ProviderAdapterError,
): ResolvedBookingOutcome {
  const unknownCategories = new Set([
    "PROVIDER_TIMEOUT",
    "PROVIDER_SERVICE_UNAVAILABLE",
    "PROVIDER_RATE_LIMITED",
    "PROVIDER_UNKNOWN_ERROR",
  ]);

  if (unknownCategories.has(error.category)) {
    return {
      outcome: "UNKNOWN",
      providerOrderId: null,
      providerReference: null,
      providerStatus: null,
      bookedAmount: null,
      bookedCurrency: null,
      bookedAt: null,
      failureCode: ErrorCodes.PROVIDER_BOOKING_UNKNOWN,
      failureMessage: error.safeMessage,
    };
  }

  const failureCode =
    error.category === "PROVIDER_UNSUPPORTED_OPERATION"
      ? ErrorCodes.PROVIDER_BOOKING_UNAVAILABLE
      : error.category === "PROVIDER_BOOKING_FAILED"
        ? ErrorCodes.PROVIDER_BOOKING_REJECTED
        : ErrorCodes.BOOKING_FAILED;

  return {
    outcome: "FAILED",
    providerOrderId: null,
    providerReference: null,
    providerStatus: null,
    bookedAmount: null,
    bookedCurrency: null,
    bookedAt: null,
    failureCode,
    failureMessage: error.safeMessage,
  };
}

export function classifyBookingExecutionError(error: unknown): ResolvedBookingOutcome {
  if (error instanceof ProviderAdapterError) {
    return classifyProviderAdapterError(error);
  }
  if (error instanceof AppError) {
    if (error.code === ErrorCodes.PROVIDER_ADAPTER_ERROR && error.cause instanceof ProviderAdapterError) {
      return classifyProviderAdapterError(error.cause);
    }
    return {
      outcome: "FAILED",
      providerOrderId: null,
      providerReference: null,
      providerStatus: null,
      bookedAmount: null,
      bookedCurrency: null,
      bookedAt: null,
      failureCode: error.code as ErrorCode,
      failureMessage: error.message,
    };
  }
  return {
    outcome: "UNKNOWN",
    providerOrderId: null,
    providerReference: null,
    providerStatus: null,
    bookedAmount: null,
    bookedCurrency: null,
    bookedAt: null,
    failureCode: ErrorCodes.PROVIDER_BOOKING_UNKNOWN,
    failureMessage: "Provider booking outcome could not be determined.",
  };
}
