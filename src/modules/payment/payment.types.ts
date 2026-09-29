import type {
  LedgerDirection,
  LedgerEntryType,
  PaymentAttemptStatus,
  PaymentCurrency,
  PaymentGatewayCode,
  PaymentStatus,
  RefundStatus,
} from "@prisma/client";
import type { QuoteSnapshot } from "../booking/booking.types.js";

export type PaymentPricingSource = {
  orchestrationRequestId: string;
  orchestrationOptionId: string;
  quoteSnapshot: QuoteSnapshot;
};

export type PaymentDto = {
  id: string;
  deliveryId: string;
  customerId: string;
  amount: number;
  currency: PaymentCurrency;
  status: PaymentStatus;
  gateway: PaymentGatewayCode;
  gatewayOrderId: string | null;
  gatewayPaymentSessionId: string | null;
  pricingSource: PaymentPricingSource;
  paidAt: Date | null;
  failedAt: Date | null;
  expiredAt: Date | null;
  refundedAmount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type PaymentAttemptDto = {
  id: string;
  paymentId: string;
  attemptNumber: number;
  gatewayPaymentId: string | null;
  gatewayOrderId: string | null;
  status: PaymentAttemptStatus;
  amount: number;
  currency: PaymentCurrency;
  paymentMethod: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  metadata: Record<string, unknown> | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type RefundDto = {
  id: string;
  paymentId: string;
  deliveryId: string;
  amount: number;
  currency: PaymentCurrency;
  status: RefundStatus;
  reasonCode: string | null;
  reason: string | null;
  gatewayRefundId: string | null;
  gatewayRefundReference: string | null;
  idempotencyKey: string;
  requestedAt: Date;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type LedgerEntryDto = {
  id: string;
  deliveryId: string;
  paymentId: string;
  refundId: string | null;
  type: LedgerEntryType;
  direction: LedgerDirection;
  amount: number;
  currency: PaymentCurrency;
  description: string | null;
  idempotencyKey: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

export type CustomerPaymentDto = {
  id: string;
  deliveryId: string;
  amount: number;
  currency: PaymentCurrency;
  status: PaymentStatus;
  gateway: PaymentGatewayCode;
  gatewayOrderId: string | null;
  paymentSessionId: string | null;
  paidAt: string | null;
  refundedAmount: number;
  latestAttempt: {
    id: string;
    attemptNumber: number;
    status: PaymentAttemptStatus;
    startedAt: string | null;
  } | null;
};

export type PaymentCreateResponsePayload = {
  payment: CustomerPaymentDto;
};
