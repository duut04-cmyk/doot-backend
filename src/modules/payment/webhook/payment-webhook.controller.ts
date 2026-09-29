import type { NextFunction, Request, Response } from "express";
import { cashfreePaymentWebhookService } from "./cashfree-payment-webhook.service.js";
import type { CashfreePaymentWebhookService } from "./cashfree-payment-webhook.service.js";

export class PaymentWebhookController {
  constructor(
    private readonly cashfreeWebhookService: CashfreePaymentWebhookService = cashfreePaymentWebhookService,
  ) {}

  handleCashfree = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const rawBody =
        req.rawBody?.toString("utf8") ??
        (typeof req.body === "string" ? req.body : undefined);
      if (!rawBody) {
        res.status(400).json({
          success: false,
          error: { code: "CASHFREE_WEBHOOK_MALFORMED", message: "Missing raw body." },
        });
        return;
      }

      const result = await this.cashfreeWebhookService.handle({
        requestId: req.requestId,
        rawBody,
        signature: req.header("x-webhook-signature") ?? undefined,
        timestamp: req.header("x-webhook-timestamp") ?? undefined,
        headerIdempotencyKey: req.header("x-idempotency-key"),
      });

      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };
}

export const paymentWebhookController = new PaymentWebhookController();
