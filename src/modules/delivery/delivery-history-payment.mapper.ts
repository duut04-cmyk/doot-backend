import type { QuoteSnapshot } from "../booking/booking.types.js";
import type {
  PaymentAttemptDto,
  PaymentDto,
  PaymentPricingSource,
  RefundDto,
} from "../payment/payment.types.js";
import {
  calculateCustomerDeliveryPricing,
  GST_PERCENT,
  LEGACY_DEFAULT_PLATFORM_FEE_PERCENT,
} from "../pricing/customer-delivery-pricing.js";
import type {
  DeliveryHistoryPayment,
  DeliveryHistoryPaymentAttempt,
  DeliveryHistoryPaymentRefund,
  DeliveryHistoryPricingBreakdown,
} from "./delivery-history.types.js";

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function resolvePricingBreakdownFromSnapshot(
  snapshot: QuoteSnapshot,
): DeliveryHistoryPricingBreakdown {
  const providerQuoteAmount = snapshot.providerQuoteAmount ?? snapshot.amount;
  const platformFeePercent =
    snapshot.platformFeePercent ?? LEGACY_DEFAULT_PLATFORM_FEE_PERCENT;

  if (
    snapshot.customerPayableAmount != null &&
    Number.isFinite(snapshot.customerPayableAmount) &&
    snapshot.platformFeeAmount != null &&
    snapshot.gstAmount != null
  ) {
    const platformFeeAmount = snapshot.platformFeeAmount;
    const gstAmount = snapshot.gstAmount;
    return {
      providerQuoteAmount,
      platformFeePercent,
      platformFeeAmount,
      subtotal: roundCurrency(providerQuoteAmount + platformFeeAmount),
      gstPercent: GST_PERCENT,
      gstAmount,
      customerPayableAmount: snapshot.customerPayableAmount,
      currency: snapshot.currency,
    };
  }

  const pricing = calculateCustomerDeliveryPricing(
    providerQuoteAmount,
    platformFeePercent,
  );
  return {
    providerQuoteAmount: pricing.providerQuoteAmount,
    platformFeePercent: pricing.platformFeePercent,
    platformFeeAmount: pricing.platformFeeAmount,
    subtotal: pricing.subtotal,
    gstPercent: pricing.gstPercent,
    gstAmount: pricing.gstAmount,
    customerPayableAmount: pricing.customerPayableAmount,
    currency: snapshot.currency,
  };
}

function mapAttempt(attempt: PaymentAttemptDto): DeliveryHistoryPaymentAttempt {
  return {
    id: attempt.id,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    amount: attempt.amount,
    currency: attempt.currency,
    gatewayPaymentId: attempt.gatewayPaymentId,
    gatewayOrderId: attempt.gatewayOrderId,
    paymentMethod: attempt.paymentMethod,
    failureCode: attempt.failureCode,
    failureMessage: attempt.failureMessage,
    startedAt: attempt.startedAt?.toISOString() ?? null,
    completedAt: attempt.completedAt?.toISOString() ?? null,
  };
}

function mapRefund(refund: RefundDto): DeliveryHistoryPaymentRefund {
  return {
    id: refund.id,
    amount: refund.amount,
    currency: refund.currency,
    status: refund.status,
    reasonCode: refund.reasonCode,
    reason: refund.reason,
    gatewayRefundId: refund.gatewayRefundId,
    gatewayRefundReference: refund.gatewayRefundReference,
    idempotencyKey: refund.idempotencyKey,
    requestedAt: refund.requestedAt.toISOString(),
    processedAt: refund.processedAt?.toISOString() ?? null,
  };
}

function pickPrimaryGatewayPaymentId(attempts: PaymentAttemptDto[]): string | null {
  const successful = attempts.find(
    (attempt) => attempt.status === "SUCCEEDED" && attempt.gatewayPaymentId,
  );
  if (successful?.gatewayPaymentId) {
    return successful.gatewayPaymentId;
  }
  const withId = attempts.find((attempt) => attempt.gatewayPaymentId);
  return withId?.gatewayPaymentId ?? null;
}

export function mapPaymentHistorySection(input: {
  payment: PaymentDto | null;
  attempts: PaymentAttemptDto[];
  refunds: RefundDto[];
}): DeliveryHistoryPayment | null {
  if (!input.payment) {
    return null;
  }

  const pricingSource = input.payment.pricingSource as PaymentPricingSource;
  const snapshot = pricingSource?.quoteSnapshot;
  const pricingBreakdown = snapshot
    ? resolvePricingBreakdownFromSnapshot(snapshot)
    : {
        providerQuoteAmount: input.payment.amount,
        platformFeePercent: 0,
        platformFeeAmount: 0,
        subtotal: input.payment.amount,
        gstPercent: GST_PERCENT,
        gstAmount: 0,
        customerPayableAmount: input.payment.amount,
        currency: input.payment.currency,
      };

  return {
    id: input.payment.id,
    status: input.payment.status,
    amount: input.payment.amount,
    currency: input.payment.currency,
    gateway: input.payment.gateway,
    gatewayOrderId: input.payment.gatewayOrderId,
    gatewayPaymentSessionId: input.payment.gatewayPaymentSessionId,
    gatewayPaymentId: pickPrimaryGatewayPaymentId(input.attempts),
    paidAt: input.payment.paidAt?.toISOString() ?? null,
    failedAt: input.payment.failedAt?.toISOString() ?? null,
    expiredAt: input.payment.expiredAt?.toISOString() ?? null,
    refundedAmount: input.payment.refundedAmount,
    pricingBreakdown,
    attempts: input.attempts.map(mapAttempt),
    refunds: input.refunds.map(mapRefund),
  };
}

export function findCancellationLinkedRefund(
  cancellationId: string,
  refunds: RefundDto[],
): RefundDto | null {
  const idempotencyKey = `cancel-refund:${cancellationId}`;
  return refunds.find((refund) => refund.idempotencyKey === idempotencyKey) ?? null;
}
