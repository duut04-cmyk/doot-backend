import { describe, expect, it } from "vitest";
import { enrichShiprocketUnknownBookingOutcome } from "../src/modules/booking/booking.shiprocket-recovery.js";
import { ErrorCodes } from "../src/core/errors/error-codes.js";

describe("Shiprocket booking identifier metadata", () => {
  it("does not replace a known numeric provider order id", () => {
    const resolved = {
      outcome: "UNKNOWN" as const,
      providerOrderId: "16161616",
      providerReference: "15151515",
      providerStatus: null,
      bookedAmount: null,
      bookedCurrency: null,
      bookedAt: null,
      failureCode: ErrorCodes.PROVIDER_BOOKING_UNKNOWN,
      failureMessage: "AWB pending",
      metadata: {
        shiprocketOrderId: "16161616",
        shiprocketShipmentId: "15151515",
        shiprocketChannelOrderId: "DOOT-ABC-123",
      },
    };
    expect(
      enrichShiprocketUnknownBookingOutcome({
        providerCode: "SHIPROCKET",
        deliveryReference: "DOOT-ABC-123",
        resolved,
      }),
    ).toEqual(resolved);
  });

  it("uses channel order id only when numeric provider order id is unknown", () => {
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
        failureMessage: "timeout",
      },
    });

    expect(enriched.providerOrderId).toBe("DOOT-ABC-123");
    expect(enriched.metadata?.shiprocketChannelOrderId).toBe("DOOT-ABC-123");
  });
});
