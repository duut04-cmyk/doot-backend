import { Router } from "express";
import {
  paymentWebhookController,
  type PaymentWebhookController,
} from "./payment-webhook.controller.js";

export function createPaymentWebhookRouter(
  controller: PaymentWebhookController = paymentWebhookController,
): Router {
  const router = Router();
  router.post("/cashfree", controller.handleCashfree);
  return router;
}
