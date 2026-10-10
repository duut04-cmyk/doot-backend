import type { PaymentCurrency } from "@prisma/client";

export type GatewayCustomerDetails = {
  customerId: string;
  email?: string | null;
  phone?: string | null;
};

export type GatewayCreateOrderInput = {
  paymentId: string;
  deliveryId: string;
  amount: number;
  currency: PaymentCurrency;
  customerReference: string;
  customer?: GatewayCustomerDetails;
  /** When set, reuse this Cashfree order id instead of generating a new one. */
  existingGatewayOrderId?: string | null;
};

export type GatewayCreateOrderResult = {
  gatewayOrderId: string;
  paymentSessionId?: string | null;
  metadata?: Record<string, unknown>;
};

export type GatewayPaymentStatusResult = {
  status: "PENDING" | "PAID" | "FAILED" | "EXPIRED";
  gatewayPaymentId?: string | null;
  paymentMethod?: string | null;
  metadata?: Record<string, unknown>;
};

export type GatewayRefundInput = {
  paymentId: string;
  gatewayOrderId: string;
  amount: number;
  currency: PaymentCurrency;
  /** Merchant refund id (Cashfree refund_id), 3–40 alphanumeric */
  merchantRefundId: string;
  idempotencyKey: string;
  refundNote?: string | null;
};

export type GatewayRefundResult = {
  /** Merchant refund id used with the gateway */
  gatewayRefundId: string;
  /** Provider-side refund reference (e.g. cf_refund_id) when available */
  gatewayRefundReference?: string | null;
  status: "PENDING" | "SUCCESS" | "FAILED";
};

export type GatewayRefundStatusInput = {
  gatewayOrderId: string;
  gatewayRefundId: string;
};
