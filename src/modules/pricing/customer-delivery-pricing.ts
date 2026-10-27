import type { QuoteSnapshot } from "../booking/booking.types.js";

/** Historical default used for legacy snapshots without a stored platform fee percent. */
export const LEGACY_DEFAULT_PLATFORM_FEE_PERCENT = 10;

/** Default effective platform fee when no valid runtime override exists. */
export const DEFAULT_PLATFORM_SERVICE_FEE_PERCENT = 10;

/** @deprecated Use DEFAULT_PLATFORM_SERVICE_FEE_PERCENT or resolved runtime fee. */
export const DOOT_PLATFORM_FEE_PERCENT = DEFAULT_PLATFORM_SERVICE_FEE_PERCENT;

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
  platformFeePercent: number = LEGACY_DEFAULT_PLATFORM_FEE_PERCENT,
): CustomerDeliveryPricing {
  const platformFeeAmount = roundCurrency(
    providerQuoteAmount * (platformFeePercent / 100),
  );
  const subtotal = roundCurrency(providerQuoteAmount + platformFeeAmount);
  const gstAmount = roundCurrency(subtotal * (GST_PERCENT / 100));
  const customerPayableAmount = roundCurrency(subtotal + gstAmount);

  return {
    providerQuoteAmount,
    platformFeePercent,
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
    | "customerPayableAmount"
    | "platformFeeAmount"
    | "gstAmount"
    | "providerQuoteAmount"
    | "platformFeePercent"
  > &
    Partial<
      Pick<
        QuoteSnapshot,
        | "customerPayableAmount"
        | "platformFeeAmount"
        | "gstAmount"
        | "providerQuoteAmount"
        | "platformFeePercent"
      >
    >,
  platformFeePercent: number,
): QuoteSnapshot {
  const providerQuoteAmount = snapshot.amount;
  const pricing = calculateCustomerDeliveryPricing(
    providerQuoteAmount,
    platformFeePercent,
  );
  return {
    ...snapshot,
    providerQuoteAmount: pricing.providerQuoteAmount,
    platformFeePercent: pricing.platformFeePercent,
    platformFeeAmount: pricing.platformFeeAmount,
    gstAmount: pricing.gstAmount,
    customerPayableAmount: pricing.customerPayableAmount,
  };
}

/**
 * Uses stored customer payable when present (frozen quote pricing).
 * Legacy or incomplete snapshots without a stored payable use 10% platform fee and 18% GST
 * on `amount`; partial pricing fields alone are not trusted.
 */
export function resolveCustomerPayableAmount(snapshot: QuoteSnapshot): number {
  if (
    snapshot.customerPayableAmount != null &&
    Number.isFinite(snapshot.customerPayableAmount)
  ) {
    return snapshot.customerPayableAmount;
  }
  return calculateCustomerDeliveryPricing(
    snapshot.amount,
    LEGACY_DEFAULT_PLATFORM_FEE_PERCENT,
  ).customerPayableAmount;
}
