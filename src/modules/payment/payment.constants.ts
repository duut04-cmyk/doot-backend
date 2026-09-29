import type { PaymentCurrency } from "@prisma/client";

export const DEFAULT_PAYMENT_CURRENCY: PaymentCurrency = "INR";

export const PAYMENT_READY_DELIVERY_STATUSES = ["OPTION_READY"] as const;

export function ledgerIdempotencyKeyForPaymentSuccess(paymentId: string): string {
  return `payment-paid:${paymentId}`;
}

export function ledgerIdempotencyKeyForRefund(refundId: string): string {
  return `refund:${refundId}`;
}
