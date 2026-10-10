import { describe, expect, it } from "vitest";
import {
  paymentSessionDiagnostics,
  validatePaymentSessionShape,
} from "../scripts/lib/cashfree-cert/session-validation.js";

const VALID_SESSION =
  "session__CvcEmNKDkmERQrxnx39ibhJ3Ii034pjc8ZVxf3qcgEXCWlgDDlHRgz2";

describe("Cashfree cert session validation", () => {
  it("accepts Cashfree-style session__ prefix with sufficient length", () => {
    expect(validatePaymentSessionShape(VALID_SESSION).ok).toBe(true);
  });

  it("accepts session_ single-underscore prefix", () => {
    expect(validatePaymentSessionShape("session_a1VXIPJo8kh7IBigVXX8LgTMupQW").ok).toBe(
      true,
    );
  });

  it("rejects missing and stub patterns", () => {
    expect(validatePaymentSessionShape(null).ok).toBe(false);
    expect(validatePaymentSessionShape("").ok).toBe(false);
    expect(validatePaymentSessionShape("stub_order_abc123").ok).toBe(false);
    expect(validatePaymentSessionShape("session_abc").ok).toBe(false);
  });

  it("returns safe diagnostics without full token", () => {
    const diag = paymentSessionDiagnostics(VALID_SESSION);
    expect(diag.paymentSessionPresent).toBe(true);
    expect(diag.paymentSessionLength).toBe(VALID_SESSION.length);
    expect(diag.paymentSessionPrefix).toBe(VALID_SESSION.slice(0, 10));
    expect(JSON.stringify(diag)).not.toContain(VALID_SESSION);
  });
});
