import type {
  PaymentAttemptDto,
  CustomerPaymentDto,
  PaymentDto,
} from "./payment.types.js";

export function toCustomerPaymentDto(
  payment: PaymentDto,
  latestAttempt: PaymentAttemptDto | null,
): CustomerPaymentDto {
  return {
    id: payment.id,
    deliveryId: payment.deliveryId,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    gateway: payment.gateway,
    gatewayOrderId: payment.gatewayOrderId,
    paymentSessionId: payment.gatewayPaymentSessionId,
    paidAt: payment.paidAt?.toISOString() ?? null,
    refundedAmount: payment.refundedAmount,
    latestAttempt: latestAttempt
      ? {
          id: latestAttempt.id,
          attemptNumber: latestAttempt.attemptNumber,
          status: latestAttempt.status,
          startedAt: latestAttempt.startedAt?.toISOString() ?? null,
        }
      : null,
  };
}
