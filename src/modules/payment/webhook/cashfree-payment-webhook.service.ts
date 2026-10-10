import { env, requireCashfreeCredentials } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import { AppError } from "../../../core/errors/app-error.js";
import { ErrorCodes } from "../../../core/errors/error-codes.js";
import { resolveCashfreePaymentWebhook } from "../gateways/cashfree/cashfree-webhook.normalize.js";
import { verifyCashfreeWebhookSignature } from "../gateways/cashfree/cashfree-webhook.verify.js";
import { paymentRepository, type IPaymentRepository } from "../payment.repository.js";
import { toMoneyDecimal } from "../payment.money.js";
import {
  paymentWebhookService,
  type PaymentWebhookService,
} from "./payment-webhook.service.js";

export class CashfreePaymentWebhookService {
  constructor(
    private readonly payments: IPaymentRepository = paymentRepository,
    private readonly webhooks: PaymentWebhookService = paymentWebhookService,
  ) {}

  async handle(input: {
    requestId: string;
    rawBody: string;
    signature?: string;
    timestamp?: string;
    headerIdempotencyKey?: string | null;
  }) {
    if (!env.CASHFREE_WEBHOOK_ENABLED) {
      throw new AppError("Cashfree webhooks are disabled.", {
        statusCode: 404,
        code: ErrorCodes.NOT_FOUND,
      });
    }

    const { clientSecret } = requireCashfreeCredentials();
    const valid = verifyCashfreeWebhookSignature({
      timestamp: input.timestamp,
      signature: input.signature,
      rawBody: input.rawBody,
      secretKey: clientSecret,
    });
    if (!valid) {
      throw new AppError("Invalid Cashfree webhook signature.", {
        statusCode: 401,
        code: ErrorCodes.CASHFREE_WEBHOOK_SIGNATURE_INVALID,
      });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(input.rawBody) as unknown;
    } catch {
      throw new AppError("Malformed Cashfree webhook payload.", {
        statusCode: 400,
        code: ErrorCodes.CASHFREE_WEBHOOK_MALFORMED,
      });
    }

    const resolved = resolveCashfreePaymentWebhook({
      payload,
      headerIdempotencyKey: input.headerIdempotencyKey,
    });

    if (resolved.action === "ignore") {
      logger.info(
        {
          requestId: input.requestId,
          reason: resolved.reason,
          ...resolved.diagnostics,
        },
        "cashfree_webhook_ignored",
      );
      return {
        processingStatus: "IGNORED" as const,
        reason: resolved.reason,
      };
    }

    if (resolved.action === "reject") {
      logger.warn(
        {
          requestId: input.requestId,
          reason: resolved.reason,
          ...resolved.diagnostics,
        },
        "cashfree_webhook_rejected",
      );
      throw new AppError("Unsupported Cashfree webhook event.", {
        statusCode: 422,
        code: ErrorCodes.CASHFREE_WEBHOOK_MALFORMED,
      });
    }

    const event = resolved.event;

    const payment = await this.payments.findByGatewayOrderId(event.gatewayOrderId);
    if (!payment) {
      throw new AppError("Payment not found for Cashfree order.", {
        statusCode: 404,
        code: ErrorCodes.PAYMENT_NOT_FOUND,
      });
    }

    if (payment.gateway !== "CASHFREE") {
      throw new AppError("Payment gateway mismatch.", {
        statusCode: 409,
        code: ErrorCodes.PAYMENT_GATEWAY_MISMATCH,
      });
    }

    const isRefundEvent =
      event.eventType === "REFUND_SUCCESS" || event.eventType === "REFUND_FAILED";

    if (!isRefundEvent && event.amount !== undefined) {
      const expected = toMoneyDecimal(payment.amount);
      const received = toMoneyDecimal(event.amount);
      if (!expected.equals(received)) {
        throw new AppError("Cashfree webhook amount mismatch.", {
          statusCode: 409,
          code: ErrorCodes.PAYMENT_INVALID_AMOUNT,
        });
      }
    }

    if (event.currency && event.currency !== payment.currency) {
      throw new AppError("Cashfree webhook currency mismatch.", {
        statusCode: 409,
        code: ErrorCodes.PAYMENT_INVALID_AMOUNT,
      });
    }

    logger.info(
      {
        requestId: input.requestId,
        paymentId: payment.id,
        deliveryId: payment.deliveryId,
        gateway: payment.gateway,
        gatewayOrderId: event.gatewayOrderId,
        eventType: event.eventType,
        cashfreeWebhookType: event.metadata?.cashfreeWebhookType,
      },
      "cashfree_webhook_received",
    );

    return this.webhooks.process({
      requestId: input.requestId,
      paymentId: payment.id,
      event,
    });
  }
}

export const cashfreePaymentWebhookService = new CashfreePaymentWebhookService();
