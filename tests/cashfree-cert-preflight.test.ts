import { describe, expect, it } from "vitest";
import { CASHFREE_SANDBOX_PG_BASE_URL } from "../scripts/lib/cashfree-cert/constants.js";
import {
  validateCertPreflight,
  type CertEnvSnapshot,
} from "../scripts/lib/cashfree-cert/preflight.js";

function baseSnapshot(overrides: Partial<CertEnvSnapshot> = {}): CertEnvSnapshot {
  return {
    paymentGateway: "cashfree",
    cashfreeEnabled: true,
    cashfreeEnvironment: "sandbox",
    hasClientId: true,
    hasClientSecret: true,
    pgBaseUrl: CASHFREE_SANDBOX_PG_BASE_URL,
    ...overrides,
  };
}

describe("Cashfree cert preflight", () => {
  it("accepts valid sandbox snapshot", () => {
    expect(validateCertPreflight(baseSnapshot()).ok).toBe(true);
  });

  it("rejects production environment", () => {
    const result = validateCertPreflight(
      baseSnapshot({ cashfreeEnvironment: "production" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("production"))).toBe(true);
    }
  });

  it("requires exact sandbox PG base URL", () => {
    const result = validateCertPreflight(
      baseSnapshot({ pgBaseUrl: "https://api.cashfree.com/pg" }),
    );
    expect(result.ok).toBe(false);
  });

  it("requires cashfree payment gateway", () => {
    const result = validateCertPreflight(baseSnapshot({ paymentGateway: "stub" }));
    expect(result.ok).toBe(false);
  });
});
