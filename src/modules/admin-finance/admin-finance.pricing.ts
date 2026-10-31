import type { QuoteSnapshot } from "../booking/booking.types.js";
import { resolvePricingBreakdownFromSnapshot } from "../delivery/delivery-history-payment.mapper.js";
import type { PaymentPricingSource } from "../payment/payment.types.js";
import type { AdminFinancePricingBreakdownDto } from "./admin-finance.types.js";

const REVENUE_DISCLAIMER =
  "Platform fee and GST are quote-time breakdown only; refunds are not allocated across provider quote, platform fee, or GST.";

export function mapPricingBreakdownFromPaymentSource(
  pricingSource: unknown,
): AdminFinancePricingBreakdownDto | null {
  if (!pricingSource || typeof pricingSource !== "object") {
    return null;
  }
  const source = pricingSource as PaymentPricingSource;
  const snapshot = source.quoteSnapshot as QuoteSnapshot | undefined;
  if (!snapshot?.currency) {
    return null;
  }
  const breakdown = resolvePricingBreakdownFromSnapshot(snapshot);
  return {
    label: "Pricing Breakdown",
    providerQuoteAmount: breakdown.providerQuoteAmount.toFixed(2),
    platformFeePercent: breakdown.platformFeePercent,
    platformFeeAmount: breakdown.platformFeeAmount.toFixed(2),
    subtotal: breakdown.subtotal.toFixed(2),
    gstPercent: breakdown.gstPercent,
    gstAmount: breakdown.gstAmount.toFixed(2),
    customerPayableAmount: breakdown.customerPayableAmount.toFixed(2),
    currency: breakdown.currency,
    orchestrationRequestId: source.orchestrationRequestId ?? null,
    orchestrationOptionId: source.orchestrationOptionId ?? null,
    snapshotMetadata: snapshot.providerMetadata ?? null,
    revenueDisclaimer: REVENUE_DISCLAIMER,
  };
}
