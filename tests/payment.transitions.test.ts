import { describe, expect, it } from "vitest";
import {
  canTransitionPayment,
  canTransitionRefund,
  isTerminalPaymentStatus,
} from "../src/modules/payment/payment.transitions.js";

describe("payment transitions", () => {
  it("allows CREATED → PENDING → PAID", () => {
    expect(canTransitionPayment("CREATED", "PENDING")).toBe(true);
    expect(canTransitionPayment("PENDING", "PAID")).toBe(true);
  });

  it("allows PAID → PARTIALLY_REFUNDED → REFUNDED", () => {
    expect(canTransitionPayment("PAID", "PARTIALLY_REFUNDED")).toBe(true);
    expect(canTransitionPayment("PARTIALLY_REFUNDED", "REFUNDED")).toBe(true);
  });

  it("rejects invalid payment transitions", () => {
    expect(canTransitionPayment("FAILED", "PAID")).toBe(false);
    expect(canTransitionPayment("REFUNDED", "PAID")).toBe(false);
    expect(canTransitionPayment("EXPIRED", "PAID")).toBe(false);
  });

  it("marks terminal payment statuses", () => {
    expect(isTerminalPaymentStatus("FAILED")).toBe(true);
    expect(isTerminalPaymentStatus("PAID")).toBe(false);
  });
});

describe("refund transitions", () => {
  it("allows REQUESTED → PENDING → SUCCESS", () => {
    expect(canTransitionRefund("REQUESTED", "PENDING")).toBe(true);
    expect(canTransitionRefund("PENDING", "SUCCESS")).toBe(true);
  });

  it("rejects SUCCESS → PENDING", () => {
    expect(canTransitionRefund("SUCCESS", "PENDING")).toBe(false);
  });
});
