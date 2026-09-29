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
  idempotencyKey: string;
};

export type GatewayRefundResult = {
  gatewayRefundId: string;
  gatewayRefundReference?: string | null;
  status: "PENDING" | "SUCCESS" | "FAILED";
};
