import type { NextFunction, Request, Response } from "express";
import {
  borzoWebhookService,
  type BorzoWebhookService,
} from "./provider.webhook.service.js";

export class BorzoWebhookController {
  constructor(
    private readonly service: BorzoWebhookService = borzoWebhookService,
  ) {}

  handle = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.rawBody) {
        res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Webhook raw body is required.",
          },
          requestId: req.requestId,
        });
        return;
      }

      const result = await this.service.handleInboundWebhook({
        requestId: req.requestId,
        rawBody: req.rawBody,
        headers: req.headers as Record<string, string | string[] | undefined>,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const borzoWebhookController = new BorzoWebhookController();
