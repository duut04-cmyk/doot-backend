import type { NextFunction, Request, Response } from "express";
import {
  shiprocketProviderWebhookService,
  type ShiprocketProviderWebhookService,
} from "./shiprocket-provider-webhook.service.js";

export class ProviderWebhookController {
  constructor(
    private readonly shiprocket: ShiprocketProviderWebhookService = shiprocketProviderWebhookService,
  ) {}

  handleShiprocket = async (
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
          error: {
            code: "VALIDATION_ERROR",
            message: "Missing raw body.",
          },
        });
        return;
      }

      const result = await this.shiprocket.handle({
        requestId: req.requestId,
        rawBody,
        apiKey: req.header("x-api-key") ?? undefined,
      });

      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };
}

export const providerWebhookController = new ProviderWebhookController();
