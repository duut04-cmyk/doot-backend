import type { QuoteSnapshot } from "../booking/booking.types.js";

export const DOOT_PLATFORM_FEE_PERCENT = 10;
export const GST_PERCENT = 18;

export type CustomerDeliveryPricing = {
  providerQuoteAmount: number;
  platformFeePercent: number;
  platformFeeAmount: number;
  subtotal: number;
  gstPercent: number;
  gstAmount: number;
  customerPayableAmount: number;
};

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateCustomerDeliveryPricing(
  providerQuoteAmount: number,
): CustomerDeliveryPricing {
  const platformFeeAmount = roundCurrency(
    providerQuoteAmount * (DOOT_PLATFORM_FEE_PERCENT / 100),
  );
  const subtotal = roundCurrency(providerQuoteAmount + platformFeeAmount);
  const gstAmount = roundCurrency(subtotal * (GST_PERCENT / 100));
  const customerPayableAmount = roundCurrency(subtotal + gstAmount);

  return {
    providerQuoteAmount,
    platformFeePercent: DOOT_PLATFORM_FEE_PERCENT,
    platformFeeAmount,
    subtotal,
    gstPercent: GST_PERCENT,
    gstAmount,
    customerPayableAmount,
  };
}

/** Provider quote remains in `amount`; customer totals are additive fields on the snapshot. */
export function enrichQuoteSnapshotWithCustomerPricing(
  snapshot: Omit<
    QuoteSnapshot,
    "customerPayableAmount" | "platformFeeAmount" | "gstAmount" | "providerQuoteAmount"
  > &
    Partial<
      Pick<
        QuoteSnapshot,
        | "customerPayableAmount"
        | "platformFeeAmount"
        | "gstAmount"
        | "providerQuoteAmount"
      >
    >,
): QuoteSnapshot {
  const providerQuoteAmount = snapshot.amount;
  const pricing = calculateCustomerDeliveryPricing(providerQuoteAmount);
  return {
    ...snapshot,
    providerQuoteAmount: pricing.providerQuoteAmount,
    platformFeeAmount: pricing.platformFeeAmount,
    gstAmount: pricing.gstAmount,
    customerPayableAmount: pricing.customerPayableAmount,
  };
}

export function resolveCustomerPayableAmount(snapshot: QuoteSnapshot): number {
  if (
    snapshot.customerPayableAmount != null &&
    Number.isFinite(snapshot.customerPayableAmount)
  ) {
    return snapshot.customerPayableAmount;
  }
  const providerQuote = snapshot.providerQuoteAmount ?? snapshot.amount;
  return calculateCustomerDeliveryPricing(providerQuote).customerPayableAmount;
}
