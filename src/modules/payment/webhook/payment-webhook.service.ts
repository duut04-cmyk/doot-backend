import { logger } from "../../../config/logger.js";
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
        logger.info(
          {
            requestId: input.requestId,
            eventType: input.event.eventType,
            paymentId: input.paymentId,
          },
          "payment_webhook_refund_deferred",
        );
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
}

export const paymentWebhookService = new PaymentWebhookService();
