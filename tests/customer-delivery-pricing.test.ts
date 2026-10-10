import { describe, expect, it } from "vitest";
import {
  calculateCustomerDeliveryPricing,
  enrichQuoteSnapshotWithCustomerPricing,
  resolveCustomerPayableAmount,
} from "../src/modules/pricing/customer-delivery-pricing.js";

describe("customer-delivery-pricing", () => {
  it("computes customer payable total from provider quote", () => {
    const pricing = calculateCustomerDeliveryPricing(150);
    expect(pricing.platformFeeAmount).toBe(15);
    expect(pricing.subtotal).toBe(165);
    expect(pricing.gstAmount).toBe(29.7);
    expect(pricing.customerPayableAmount).toBe(194.7);
  });

  it("enriches quote snapshot while keeping provider amount", () => {
    const snapshot = enrichQuoteSnapshotWithCustomerPricing({
      amount: 150,
      currency: "INR",
    });
    expect(snapshot.amount).toBe(150);
    expect(snapshot.customerPayableAmount).toBe(194.7);
  });

  it("resolves payable from legacy snapshots without customer fields", () => {
    expect(resolveCustomerPayableAmount({ amount: 150, currency: "INR" })).toBe(194.7);
  });
});
