export const NORMALIZED_PAYMENT_EVENT_TYPES = [
  "PAYMENT_SUCCESS",
  "PAYMENT_FAILED",
  "PAYMENT_PENDING",
  "REFUND_SUCCESS",
  "REFUND_FAILED",
] as const;

export type NormalizedPaymentEventType =
  (typeof NORMALIZED_PAYMENT_EVENT_TYPES)[number];

export type NormalizedPaymentWebhookEvent = {
  eventType: NormalizedPaymentEventType;
  gatewayOrderId: string;
  gatewayPaymentId?: string | null;
  gatewayRefundId?: string | null;
  amount?: number;
  currency?: string;
  paymentMethod?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
};
