import express, { Router } from "express";
import {
  borzoWebhookController,
  type BorzoWebhookController,
} from "./provider.webhook.controller.js";

const BORZO_WEBHOOK_BODY_LIMIT = "256kb";

function captureRawBody(
  req: express.Request,
  _res: express.Response,
  buf: Buffer,
): void {
  req.rawBody = buf;
}

export function createBorzoWebhookRouter(
  controller: BorzoWebhookController = borzoWebhookController,
): Router {
  const router = Router();

  router.post(
    "/webhooks",
    express.json({
      limit: BORZO_WEBHOOK_BODY_LIMIT,
      verify: captureRawBody,
    }),
    controller.handle,
  );

  return router;
}

export const borzoWebhookRouter = createBorzoWebhookRouter();
