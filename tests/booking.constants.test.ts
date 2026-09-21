import { describe, expect, it } from "vitest";
import { buildBookingCorrelationReference } from "../src/modules/booking/booking.constants.js";
import { buildCancellationCorrelationReference } from "../src/modules/cancellation/cancellation.constants.js";

describe("delivery correlation references", () => {
  it("builds booking correlation without duplicating the delivery prefix", () => {
    expect(buildBookingCorrelationReference("DOTT-1000", 1)).toBe(
      "DOTT-1000-BOOKING-1",
    );
  });

  it("builds cancellation correlation without duplicating the delivery prefix", () => {
    expect(buildCancellationCorrelationReference("DOTT-1000", 2)).toBe(
      "DOTT-1000-CANCEL-2",
    );
  });
});
