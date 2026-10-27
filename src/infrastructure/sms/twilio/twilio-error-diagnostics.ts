import type { SmsSendFailureDiagnostics, SmsSendOutcome } from "../sms.types.js";

export type TwilioFailureCategory =
  | "invalid_recipient"
  | "provider_rejection"
  | "provider_server_error"
  | "network_timeout"
  | "unclassified";

type TwilioErrorShape = {
  status?: number;
  code?: number;
  message?: string;
};

/** Last four characters of Account SID for console cross-check (never log full SID). */
export function twilioAccountSidSuffix(accountSid: string): string | undefined {
  const trimmed = accountSid.trim();
  if (trimmed.length < 4) {
    return undefined;
  }
  return trimmed.slice(-4);
}

/** Redact phone-like segments and long digit runs from Twilio error text. */
export function sanitizeTwilioErrorMessage(message: string): string {
  let sanitized = message;
  sanitized = sanitized.replace(/\+?\d[\d\s().-]{8,}\d/g, "[redacted-phone]");
  sanitized = sanitized.replace(/\b\d{6,}\b/g, "[redacted-digits]");
  return sanitized.slice(0, 500);
}

function readTwilioErrorShape(error: unknown): TwilioErrorShape {
  if (!error || typeof error !== "object") {
    return {};
  }

  const record = error as Record<string, unknown>;
  const status =
    typeof record.status === "number"
      ? record.status
      : typeof record.statusCode === "number"
        ? record.statusCode
        : undefined;

  const code =
    typeof record.code === "number"
      ? record.code
      : typeof record.code === "string" && /^\d+$/.test(record.code)
        ? Number(record.code)
        : undefined;

  const message =
    typeof record.message === "string"
      ? record.message
      : error instanceof Error
        ? error.message
        : undefined;

  return { status, code, message };
}

/** Map Twilio / transport errors to operational SMS outcomes (conservative). */
export function mapTwilioErrorToOutcome(error: unknown): SmsSendOutcome {
  const { status, code } = readTwilioErrorShape(error);

  if (status === 408) {
    return "TIMEOUT";
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return "FAILED";
  }
  if (status !== undefined && status >= 500) {
    return "UNKNOWN";
  }

  if (typeof code === "number" && code >= 20_000 && code < 40_000) {
    return "FAILED";
  }

  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return "TIMEOUT";
    }
    const errno = (error as NodeJS.ErrnoException).code;
    if (errno === "ETIMEDOUT" || errno === "ESOCKETTIMEDOUT") {
      return "TIMEOUT";
    }
  }

  return "UNKNOWN";
}

function failureCategoryForOutcome(
  outcome: SmsSendOutcome,
  context: "invalid_recipient" | "api_error",
): TwilioFailureCategory {
  if (context === "invalid_recipient") {
    return "invalid_recipient";
  }
  switch (outcome) {
    case "FAILED":
      return "provider_rejection";
    case "TIMEOUT":
      return "network_timeout";
    case "UNKNOWN":
      return "provider_server_error";
    default:
      return "unclassified";
  }
}

export function buildInvalidRecipientDiagnostics(
  accountSid: string,
): SmsSendFailureDiagnostics {
  return {
    provider: "TWILIO",
    failureCategory: "invalid_recipient",
    messageSidReturned: false,
    accountSidSuffix: twilioAccountSidSuffix(accountSid),
  };
}

export function buildTwilioApiFailureDiagnostics(
  error: unknown,
  outcome: SmsSendOutcome,
  accountSid: string,
): SmsSendFailureDiagnostics {
  const shape = readTwilioErrorShape(error);
  const category =
    outcome === "FAILED"
      ? "provider_rejection"
      : outcome === "TIMEOUT"
        ? "network_timeout"
        : outcome === "UNKNOWN"
          ? "provider_server_error"
          : failureCategoryForOutcome(outcome, "api_error");

  return {
    provider: "TWILIO",
    failureCategory: category,
    twilioErrorCode: shape.code,
    httpStatus: shape.status,
    sanitizedMessage: shape.message
      ? sanitizeTwilioErrorMessage(shape.message)
      : undefined,
    messageSidReturned: false,
    accountSidSuffix: twilioAccountSidSuffix(accountSid),
  };
}
