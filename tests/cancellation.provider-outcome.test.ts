import { describe, expect, it } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { resolveCancellationResult } from "../src/modules/cancellation/cancellation.provider-outcome.js";

describe("resolveCancellationResult", () => {
  it("maps UNKNOWN adapter outcomes with failure metadata", () => {
    const resolved = resolveCancellationResult({
      success: false,
      outcome: "UNKNOWN",
      providerCancellationId: null,
      status: "UNKNOWN",
      reason: "Shiprocket cancellation could not be confirmed.",
      cancelledAt: null,
    });

    expect(resolved.outcome).toBe("UNKNOWN");
    expect(resolved.failureCode).toBe(ErrorCodes.CANCELLATION_UNKNOWN);
    expect(resolved.failureMessage).toBe(
      "Shiprocket cancellation could not be confirmed.",
    );
  });
});
