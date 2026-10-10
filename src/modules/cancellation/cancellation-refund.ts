import { logger } from "../../config/logger.js";
import { paymentService, type PaymentService } from "../payment/payment.service.js";
import {
  paymentRepository,
  type IPaymentRepository,
} from "../payment/payment.repository.js";
import type { RefundDto } from "../payment/payment.types.js";

export type CancellationRefundSummary = {
  refundId: string;
  status: RefundDto["status"];
  amount: number;
  currency: string;
  failureMessage?: string | null;
};

/**
 * After a successful pre-pickup cancellation, refund 100% of remaining prepaid amount.
 * No invented fees. Skips unpaid / already-fully-refunded payments.
 */
export async function refundPrepaidAfterCancellation(input: {
  deliveryId: string;
  cancellationId: string;
  reasonCode: string;
  reasonMessage?: string | null;
  payments?: IPaymentRepository;
  paymentSvc?: PaymentService;
}): Promise<CancellationRefundSummary | null> {
  const payments = input.payments ?? paymentRepository;
  const paymentSvc = input.paymentSvc ?? paymentService;

  const idempotencyKey = `cancel-refund:${input.cancellationId}`;
  const existingRefund = await payments.findRefundByIdempotencyKey(idempotencyKey);
  if (existingRefund) {
    return {
      refundId: existingRefund.id,
      status: existingRefund.status,
      amount: existingRefund.amount,
      currency: existingRefund.currency,
      failureMessage:
        existingRefund.status === "FAILED"
          ? "Refund failed after cancellation; reconciliation required."
          : null,
    };
  }

  const payment = await payments.findByDeliveryId(input.deliveryId);
  if (!payment) {
    return null;
  }
  if (payment.status !== "PAID" && payment.status !== "PARTIALLY_REFUNDED") {
    return null;
  }

  const reserved = await payments.sumActiveRefundAmounts(payment.id);
  const remaining = Math.max(0, payment.amount - reserved);
  if (remaining <= 0) {
    return null;
  }

  try {
    const refund = await paymentSvc.requestRefund({
      paymentId: payment.id,
      amount: remaining,
      idempotencyKey,
      reasonCode: input.reasonCode,
      reason: input.reasonMessage ?? `Cancellation ${input.cancellationId}`,
    });
    return {
      refundId: refund.id,
      status: refund.status,
      amount: refund.amount,
      currency: refund.currency,
    };
  } catch (error) {
    logger.error(
      {
        deliveryId: input.deliveryId,
        cancellationId: input.cancellationId,
        paymentId: payment.id,
        err: error instanceof Error ? error.message : "unknown",
      },
      "cancellation_refund_failed",
    );
    const existing = await payments.findRefundByIdempotencyKey(idempotencyKey);
    if (existing) {
      return {
        refundId: existing.id,
        status: existing.status,
        amount: existing.amount,
        currency: existing.currency,
        failureMessage:
          existing.status === "FAILED"
            ? "Refund failed after cancellation; reconciliation required."
            : null,
      };
    }
    return {
      refundId: "",
      status: "FAILED",
      amount: remaining,
      currency: payment.currency,
      failureMessage:
        error instanceof Error
          ? error.message
          : "Refund failed after cancellation; reconciliation required.",
    };
  }
}
