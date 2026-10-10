import { logger } from "../../../config/logger.js";
import { AppError } from "../../../core/errors/app-error.js";
import { ErrorCodes } from "../../../core/errors/error-codes.js";
import { paymentRepository, type IPaymentRepository } from "../payment.repository.js";
import { paymentService, type PaymentService } from "../payment.service.js";
import type { NormalizedPaymentWebhookEvent } from "./payment-webhook.types.js";

export class PaymentWebhookService {
  constructor(
    private readonly payments: PaymentService = paymentService,
    private readonly paymentRepo: IPaymentRepository = paymentRepository,
  ) {}

  async process(input: {
    requestId: string;
    event: NormalizedPaymentWebhookEvent;
    paymentId: string;
  }) {
    switch (input.event.eventType) {
      case "PAYMENT_SUCCESS":
        await this.payments.markPaymentPaid({
          paymentId: input.paymentId,
          gatewayPaymentId: input.event.gatewayPaymentId,
          paymentMethod: input.event.paymentMethod,
        });
        break;
      case "PAYMENT_FAILED": {
        const current = await this.paymentRepo.findById(input.paymentId);
        if (current?.status === "PAID") {
          break;
        }
        await this.payments.markPaymentFailed({
          paymentId: input.paymentId,
          failureCode: input.event.failureCode,
          failureMessage: input.event.failureMessage,
        });
        break;
      }
      case "PAYMENT_PENDING": {
        const current = await this.paymentRepo.findById(input.paymentId);
        if (current?.status === "PAID") {
          break;
        }
        await this.payments.markPaymentPending({
          paymentId: input.paymentId,
          gatewayOrderId: input.event.gatewayOrderId,
        });
        break;
      }
      case "REFUND_SUCCESS":
      case "REFUND_FAILED":
        await this.processRefundEvent(input);
        break;
      default:
        break;
    }

    logger.info(
      {
        requestId: input.requestId,
        eventType: input.event.eventType,
        paymentId: input.paymentId,
      },
      "payment_webhook_processed",
    );

    return { processingStatus: "PROCESSED" as const };
  }

  private async processRefundEvent(input: {
    requestId: string;
    event: NormalizedPaymentWebhookEvent;
    paymentId: string;
  }) {
    const gatewayRefundId = input.event.gatewayRefundId;
    if (!gatewayRefundId) {
      throw new AppError("Refund webhook missing refund id.", {
        statusCode: 422,
        code: ErrorCodes.CASHFREE_WEBHOOK_MALFORMED,
      });
    }

    const refund =
      (await this.paymentRepo.findRefundByGatewayRefundId(gatewayRefundId)) ?? null;

    if (!refund) {
      throw new AppError("Refund not found for Cashfree refund id.", {
        statusCode: 404,
        code: ErrorCodes.REFUND_NOT_FOUND,
      });
    }

    if (refund.paymentId !== input.paymentId) {
      throw new AppError("Refund does not belong to payment.", {
        statusCode: 409,
        code: ErrorCodes.PAYMENT_GATEWAY_MISMATCH,
      });
    }

    if (refund.status === "SUCCESS") {
      return;
    }

    if (input.event.eventType === "REFUND_SUCCESS") {
      await this.payments.markRefundSuccessful({
        refundId: refund.id,
        gatewayRefundId: refund.gatewayRefundId ?? gatewayRefundId,
        gatewayRefundReference:
          refund.gatewayRefundReference ??
          (gatewayRefundId !== refund.gatewayRefundId ? gatewayRefundId : null),
      });
      return;
    }

    if (refund.status === "FAILED") {
      return;
    }

    await this.payments.markRefundFailed({
      refundId: refund.id,
      reason: input.event.failureMessage ?? "Refund failed via webhook.",
    });
  }
}

export const paymentWebhookService = new PaymentWebhookService();
