import { describe, expect, it } from "vitest";
import { normalizeProviderTrackingStatus } from "../src/modules/tracking/tracking.normalization.js";

describe("normalizeProviderTrackingStatus", () => {
  it("maps common Shiprocket forward statuses", () => {
    expect(normalizeProviderTrackingStatus("IN TRANSIT")).toBe("IN_TRANSIT");
    expect(normalizeProviderTrackingStatus("Out For Delivery")).toBe("IN_TRANSIT");
    expect(normalizeProviderTrackingStatus("Picked Up")).toBe("PICKED_UP");
    expect(normalizeProviderTrackingStatus("Delivered")).toBe("DELIVERED");
  });

  it("does not map Undelivered to DELIVERED (word-boundary delivered match)", () => {
    expect(normalizeProviderTrackingStatus("Undelivered")).toBe("UNKNOWN");
    expect(normalizeProviderTrackingStatus("UNDELIVERED")).toBe("UNKNOWN");
  });

  it("keeps delivery-attempt labels UNKNOWN (lifecycle OTP-gated in tracking.service)", () => {
    expect(normalizeProviderTrackingStatus("Delivery attempted")).toBe("UNKNOWN");
  });

  it("maps explicit failure wording to FAILED", () => {
    expect(normalizeProviderTrackingStatus("Delivery failed")).toBe("FAILED");
  });

  it("maps representative RTO and return scan labels without inventing new statuses", () => {
    expect(normalizeProviderTrackingStatus("RTO IN TRANSIT")).toBe("IN_TRANSIT");
    expect(normalizeProviderTrackingStatus("RTO Delivered")).toBe("DELIVERED");
    expect(normalizeProviderTrackingStatus("Return to Origin")).toBe("UNKNOWN");
  });
});
