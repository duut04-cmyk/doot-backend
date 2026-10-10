import { describe, expect, it } from "vitest";
import { CERT_SIMULATED_CF_PAYMENT_PREFIX } from "../scripts/lib/cashfree-cert/constants.js";
import {
  classifyPaidTier,
  isSimulatedGatewayPaymentId,
} from "../scripts/lib/cashfree-cert/paid-tier.js";

describe("Cashfree cert PAID tier", () => {
  it("returns NONE when not PAID", () => {
    expect(classifyPaidTier({ paymentStatus: "PENDING", gatewayPaymentId: null })).toBe(
      "NONE",
    );
  });

  it("classifies sim- prefix as SIMULATED", () => {
    expect(
      classifyPaidTier({
        paymentStatus: "PAID",
        gatewayPaymentId: `${CERT_SIMULATED_CF_PAYMENT_PREFIX}uuid`,
      }),
    ).toBe("SIMULATED");
    expect(isSimulatedGatewayPaymentId(`${CERT_SIMULATED_CF_PAYMENT_PREFIX}x`)).toBe(
      true,
    );
  });

  it("classifies real-like cf payment id as LIVE_E2E", () => {
    expect(
      classifyPaidTier({
        paymentStatus: "PAID",
        gatewayPaymentId: "4105073870",
      }),
    ).toBe("LIVE_E2E");
  });
});
