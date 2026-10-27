import { ErrorCodes } from "../../core/errors/error-codes.js";
import type { SmsSendOutcome } from "./sms.types.js";

export const SMS_SEND_OUTCOMES = [
  "ACCEPTED",
  "FAILED",
  "TIMEOUT",
  "UNKNOWN",
] as const satisfies readonly SmsSendOutcome[];

const SMS_SEND_OUTCOME_SET = new Set<string>(SMS_SEND_OUTCOMES);

export type SmsDeliveryFailureCause = {
  smsOutcome: SmsSendOutcome;
};

/** Runtime validation — invalid values are treated as ambiguous (UNKNOWN). */
export function parseSmsSendOutcome(value: unknown): SmsSendOutcome {
  if (typeof value !== "string") {
    return "UNKNOWN";
  }
  if (SMS_SEND_OUTCOME_SET.has(value)) {
    return value as SmsSendOutcome;
  }
  return "UNKNOWN";
}

/** OTP recovery: only definite provider rejection should drop the new OTP row. */
export function shouldInvalidateOtpAfterSmsFailure(outcome: SmsSendOutcome): boolean {
  return outcome === "FAILED";
}

export function isAmbiguousSmsOutcome(outcome: SmsSendOutcome): boolean {
  return outcome === "TIMEOUT" || outcome === "UNKNOWN";
}

/** Classify an SMS send error for OTP recovery (conservative on missing/invalid metadata). */
export function readSmsOutcomeFromError(error: unknown): SmsSendOutcome {
  if (!(error instanceof Error)) {
    return "UNKNOWN";
  }

  const appError = error as Error & { code?: string; cause?: unknown };

  if (appError.code === ErrorCodes.SMS_NOT_CONFIGURED) {
    return "FAILED";
  }

  if (appError.code !== ErrorCodes.SMS_DELIVERY_FAILED) {
    return "UNKNOWN";
  }

  const cause = appError.cause;
  if (cause && typeof cause === "object" && "smsOutcome" in cause) {
    return parseSmsSendOutcome((cause as SmsDeliveryFailureCause).smsOutcome);
  }

  return "UNKNOWN";
}
