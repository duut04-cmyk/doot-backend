import { describe, expect, it } from "vitest";
import {
  calculateCustomerDeliveryPricing,
  DEFAULT_PLATFORM_SERVICE_FEE_PERCENT,
  enrichQuoteSnapshotWithCustomerPricing,
  LEGACY_DEFAULT_PLATFORM_FEE_PERCENT,
  resolveCustomerPayableAmount,
} from "../src/modules/pricing/customer-delivery-pricing.js";

describe("customer-delivery-pricing", () => {
  it("computes customer payable total from provider quote at default 10%", () => {
    const pricing = calculateCustomerDeliveryPricing(150);
    expect(pricing.platformFeePercent).toBe(10);
    expect(pricing.platformFeeAmount).toBe(15);
    expect(pricing.subtotal).toBe(165);
    expect(pricing.gstAmount).toBe(29.7);
    expect(pricing.customerPayableAmount).toBe(194.7);
  });

  it("uses an alternate configured fee percentage for new quotes", () => {
    const pricing = calculateCustomerDeliveryPricing(100, 20);
    expect(pricing.platformFeeAmount).toBe(20);
    expect(pricing.subtotal).toBe(120);
    expect(pricing.gstAmount).toBe(21.6);
    expect(pricing.customerPayableAmount).toBe(141.6);
  });

  it("supports zero and maximum platform fee percentages", () => {
    const zero = calculateCustomerDeliveryPricing(200, 0);
    expect(zero.platformFeeAmount).toBe(0);
    expect(zero.customerPayableAmount).toBe(236);

    const max = calculateCustomerDeliveryPricing(100, 100);
    expect(max.platformFeeAmount).toBe(100);
    expect(max.customerPayableAmount).toBe(236);
  });

  it("enriches quote snapshot while keeping provider amount and frozen fee percent", () => {
    const snapshot = enrichQuoteSnapshotWithCustomerPricing(
      {
        amount: 150,
        currency: "INR",
      },
      DEFAULT_PLATFORM_SERVICE_FEE_PERCENT,
    );
    expect(snapshot.amount).toBe(150);
    expect(snapshot.platformFeePercent).toBe(10);
    expect(snapshot.customerPayableAmount).toBe(194.7);
  });

  it("resolves payable from legacy snapshots without customer fields", () => {
    expect(resolveCustomerPayableAmount({ amount: 150, currency: "INR" })).toBe(194.7);
  });

  it("uses stored customer payable without recomputing when admin fee changes", () => {
    const enriched = enrichQuoteSnapshotWithCustomerPricing(
      { amount: 150, currency: "INR" },
      10,
    );
    expect(
      resolveCustomerPayableAmount({
        ...enriched,
        platformFeePercent: 25,
      }),
    ).toBe(194.7);
  });

  it("ignores partial pricing fields when customer payable is missing", () => {
    expect(
      resolveCustomerPayableAmount({
        amount: 150,
        currency: "INR",
        platformFeePercent: 5,
        platformFeeAmount: 7.5,
      }),
    ).toBe(
      calculateCustomerDeliveryPricing(150, LEGACY_DEFAULT_PLATFORM_FEE_PERCENT)
        .customerPayableAmount,
    );
  });
});
