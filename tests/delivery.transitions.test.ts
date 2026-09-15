import { describe, expect, it } from "vitest";
import {
  canTransitionDelivery,
  CANCELLABLE_DELIVERY_STATUSES,
  isStaleOperationalTransition,
  isTerminalDeliveryStatus,
} from "../src/modules/delivery/delivery.transitions.js";

describe("delivery transitions", () => {
  it("allows the operational lifecycle path", () => {
    expect(canTransitionDelivery("BOOKED", "DRIVER_ASSIGNED")).toBe(true);
    expect(canTransitionDelivery("DRIVER_ASSIGNED", "PICKUP_OTP_PENDING")).toBe(
      true,
    );
    expect(canTransitionDelivery("PICKUP_OTP_PENDING", "PICKED_UP")).toBe(true);
    expect(canTransitionDelivery("PICKED_UP", "IN_TRANSIT")).toBe(true);
    expect(canTransitionDelivery("IN_TRANSIT", "DELIVERY_OTP_PENDING")).toBe(
      true,
    );
    expect(canTransitionDelivery("DELIVERY_OTP_PENDING", "DELIVERED")).toBe(
      true,
    );
  });

  it("blocks transitions from terminal statuses", () => {
    expect(isTerminalDeliveryStatus("DELIVERED")).toBe(true);
    expect(isTerminalDeliveryStatus("CANCELLED")).toBe(true);
    expect(canTransitionDelivery("DELIVERED", "IN_TRANSIT")).toBe(false);
    expect(canTransitionDelivery("CANCELLED", "BOOKED")).toBe(false);
  });

  it("detects stale operational transitions", () => {
    expect(
      isStaleOperationalTransition("IN_TRANSIT", "DRIVER_ASSIGNED"),
    ).toBe(true);
    expect(isStaleOperationalTransition("DELIVERED", "IN_TRANSIT")).toBe(true);
    expect(isStaleOperationalTransition("PICKED_UP", "IN_TRANSIT")).toBe(false);
  });

  it("lists cancellable pre-pickup statuses", () => {
    expect(CANCELLABLE_DELIVERY_STATUSES).toContain("BOOKED");
    expect(CANCELLABLE_DELIVERY_STATUSES).toContain("PICKUP_OTP_PENDING");
    expect(CANCELLABLE_DELIVERY_STATUSES).not.toContain("PICKED_UP");
  });
});
