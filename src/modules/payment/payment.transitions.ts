import type { PaymentStatus, RefundStatus } from "@prisma/client";

const TERMINAL_PAYMENT_STATUSES = new Set<PaymentStatus>([
  "FAILED",
  "EXPIRED",
  "REFUNDED",
]);

const PAYMENT_TRANSITIONS: Partial<Record<PaymentStatus, PaymentStatus[]>> = {
  CREATED: ["PENDING", "FAILED", "EXPIRED"],
  PENDING: ["PAID", "FAILED", "EXPIRED"],
  PAID: ["PARTIALLY_REFUNDED", "REFUNDED"],
  PARTIALLY_REFUNDED: ["PARTIALLY_REFUNDED", "REFUNDED"],
};

const TERMINAL_REFUND_STATUSES = new Set<RefundStatus>([
  "SUCCESS",
  "FAILED",
  "CANCELLED",
]);

const REFUND_TRANSITIONS: Partial<Record<RefundStatus, RefundStatus[]>> = {
  REQUESTED: ["PENDING", "SUCCESS", "FAILED", "CANCELLED"],
  PENDING: ["SUCCESS", "FAILED"],
};

export function isTerminalPaymentStatus(status: PaymentStatus): boolean {
  return TERMINAL_PAYMENT_STATUSES.has(status);
}

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  if (from === to) {
    return true;
  }
  if (isTerminalPaymentStatus(from)) {
    return false;
  }
  const allowed = PAYMENT_TRANSITIONS[from];
  return allowed?.includes(to) ?? false;
}

export function isTerminalRefundStatus(status: RefundStatus): boolean {
  return TERMINAL_REFUND_STATUSES.has(status);
}

export function canTransitionRefund(from: RefundStatus, to: RefundStatus): boolean {
  if (from === to) {
    return true;
  }
  if (isTerminalRefundStatus(from)) {
    return false;
  }
  const allowed = REFUND_TRANSITIONS[from];
  return allowed?.includes(to) ?? false;
}

export const PAYMENT_STATUS_TRANSITIONS_DOC = PAYMENT_TRANSITIONS;
export const REFUND_STATUS_TRANSITIONS_DOC = REFUND_TRANSITIONS;
