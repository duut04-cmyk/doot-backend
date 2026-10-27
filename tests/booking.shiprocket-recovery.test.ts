import { describe, expect, it } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { enrichShiprocketUnknownBookingOutcome } from "../src/modules/booking/booking.shiprocket-recovery.js";

describe("Shiprocket booking recovery hints", () => {
  it("adds channel order id when Shiprocket booking is UNKNOWN without provider order id", () => {
    const enriched = enrichShiprocketUnknownBookingOutcome({
      providerCode: "SHIPROCKET",
      deliveryReference: "DOOT-ABC-123",
      resolved: {
        outcome: "UNKNOWN",
        providerOrderId: null,
        providerReference: null,
        providerStatus: null,
        bookedAmount: null,
        bookedCurrency: null,
        bookedAt: null,
        failureCode: ErrorCodes.PROVIDER_BOOKING_UNKNOWN,
        failureMessage: "Timed out.",
      },
    });

    expect(enriched.providerOrderId).toBe("DOOT-ABC-123");
    expect(enriched.metadata?.shiprocketChannelOrderId).toBe("DOOT-ABC-123");
  });

  it("does not alter non-Shiprocket providers", () => {
    const resolved = {
      outcome: "UNKNOWN" as const,
      providerOrderId: null,
      providerReference: null,
      providerStatus: null,
      bookedAmount: null,
      bookedCurrency: null,
      bookedAt: null,
      failureCode: ErrorCodes.PROVIDER_BOOKING_UNKNOWN,
      failureMessage: "Timed out.",
    };
    expect(
      enrichShiprocketUnknownBookingOutcome({
        providerCode: "MOCK",
        deliveryReference: "DOOT-1",
        resolved,
      }),
    ).toEqual(resolved);
  });
});
