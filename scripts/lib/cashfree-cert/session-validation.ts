import { MIN_PAYMENT_SESSION_LENGTH } from "./constants.js";

export type SessionValidationResult = { ok: true } | { ok: false; reason: string };

export function validatePaymentSessionShape(
  sessionId: string | null | undefined,
): SessionValidationResult {
  if (sessionId == null || sessionId.trim() === "") {
    return { ok: false, reason: "missing" };
  }
  const trimmed = sessionId.trim();
  if (trimmed.startsWith("stub_order_")) {
    return { ok: false, reason: "stub_order_pattern" };
  }
  if (!trimmed.startsWith("session_")) {
    return { ok: false, reason: "invalid_prefix" };
  }
  if (trimmed.length < MIN_PAYMENT_SESSION_LENGTH) {
    return { ok: false, reason: "too_short" };
  }
  if (trimmed === "session_abc" || trimmed === "session_abc123") {
    return { ok: false, reason: "test_placeholder" };
  }
  return { ok: true };
}

/** Safe log fields — never the full session token. */
export function paymentSessionDiagnostics(sessionId: string | null | undefined): {
  paymentSessionPresent: boolean;
  paymentSessionLength: number;
  paymentSessionPrefix: string | null;
} {
  if (!sessionId?.trim()) {
    return {
      paymentSessionPresent: false,
      paymentSessionLength: 0,
      paymentSessionPrefix: null,
    };
  }
  const trimmed = sessionId.trim();
  return {
    paymentSessionPresent: true,
    paymentSessionLength: trimmed.length,
    paymentSessionPrefix: trimmed.slice(0, 10),
  };
}
