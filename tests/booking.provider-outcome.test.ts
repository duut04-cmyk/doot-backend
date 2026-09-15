import { describe, expect, it } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import {
  classifyProviderAdapterError,
  resolveNormalizedBookingResult,
} from "../src/modules/booking/booking.provider-outcome.js";
import { ProviderAdapterError } from "../src/modules/provider/contracts/provider-error.js";

describe("booking provider outcome", () => {
  it("maps successful adapter result to BOOKED", () => {
    const resolved = resolveNormalizedBookingResult({
      success: true,
      providerBookingId: "PO-1",
      providerReference: "REF-1",
      status: "CONFIRMED",
      bookedAt: "2026-01-01T10:00:00.000Z",
      estimatedPickupAt: null,
      estimatedDeliveryAt: null,
      trackingUrl: null,
      driver: null,
      service: null,
      reason: null,
      amount: { amount: 150, currency: "INR" },
    });
    expect(resolved.outcome).toBe("BOOKED");
    expect(resolved.providerOrderId).toBe("PO-1");
  });

  it("maps explicit UNKNOWN outcome", () => {
    const resolved = resolveNormalizedBookingResult({
      success: false,
      outcome: "UNKNOWN",
      providerBookingId: null,
      providerReference: null,
      status: "UNKNOWN",
      bookedAt: null,
      estimatedPickupAt: null,
      estimatedDeliveryAt: null,
      trackingUrl: null,
      driver: null,
      service: null,
      reason: "timeout",
    });
    expect(resolved.outcome).toBe("UNKNOWN");
  });

  it("classifies provider timeout as UNKNOWN", () => {
    const resolved = classifyProviderAdapterError(
      new ProviderAdapterError({
        providerCode: "MOCK",
        operation: "createBooking",
        category: "PROVIDER_TIMEOUT",
        safeMessage: "Timed out.",
      }),
    );
    expect(resolved.outcome).toBe("UNKNOWN");
    expect(resolved.failureCode).toBe(ErrorCodes.PROVIDER_BOOKING_UNKNOWN);
  });

  it("classifies booking rejection as FAILED", () => {
    const resolved = classifyProviderAdapterError(
      new ProviderAdapterError({
        providerCode: "MOCK",
        operation: "createBooking",
        category: "PROVIDER_BOOKING_FAILED",
        safeMessage: "Rejected.",
      }),
    );
    expect(resolved.outcome).toBe("FAILED");
    expect(resolved.failureCode).toBe(ErrorCodes.PROVIDER_BOOKING_REJECTED);
  });
});
