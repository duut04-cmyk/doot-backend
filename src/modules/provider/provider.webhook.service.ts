import { logger } from "../../config/logger.js";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import { requireBorzoCallbackSecret } from "../../config/env.js";
import { verifyBorzoWebhookSignature } from "./adapters/borzo/borzo.webhook.signature.js";
import { parseBorzoWebhookCallback } from "./adapters/borzo/borzo.webhook.schemas.js";
import {
  buildBorzoProviderEventKey,
  extractBorzoWebhookIds,
  hashWebhookPayload,
  mapBorzoWebhookCallbackToNormalizedEvent,
} from "./adapters/borzo/borzo.webhook.mapper.js";
import { BORZO_PROVIDER_CODE } from "./adapters/borzo/borzo.constants.js";
import { normalizedProviderWebhookEventSchema } from "./contracts/webhook.js";
import {
  ProviderWebhookDuplicateEventError,
  providerWebhookEventRepository,
  type IProviderWebhookEventRepository,
} from "./provider.webhook.repository.js";
import {
  ProviderWebhookProcessor,
  providerWebhookProcessor,
} from "./provider.webhook.processor.js";

const BORZO_SIGNATURE_HEADER = "x-dv-signature";

export type BorzoWebhookHandleResult = {
  received: true;
  duplicate: boolean;
};

export class BorzoWebhookService {
  constructor(
    private readonly repository: IProviderWebhookEventRepository = providerWebhookEventRepository,
    private readonly processor: ProviderWebhookProcessor = providerWebhookProcessor,
  ) {}

  async handleInboundWebhook(input: {
    requestId: string;
    rawBody: Buffer;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<BorzoWebhookHandleResult> {
    const secret = requireBorzoCallbackSecret();
    const signatureHeader = this.readHeader(input.headers, BORZO_SIGNATURE_HEADER);

    if (
      !verifyBorzoWebhookSignature({
        rawBody: input.rawBody,
        signatureHeader,
        secret,
      })
    ) {
      logger.warn(
        {
          requestId: input.requestId,
          providerCode: BORZO_PROVIDER_CODE,
          operation: "webhook",
        },
        "provider_webhook_signature_rejected",
      );
      throw new AppError("Invalid webhook signature.", {
        statusCode: 401,
        code: ErrorCodes.INVALID_PROVIDER_WEBHOOK_SIGNATURE,
      });
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(input.rawBody.toString("utf8"));
    } catch {
      throw new AppError("Webhook body must be valid JSON.", {
        statusCode: 400,
        code: ErrorCodes.VALIDATION_ERROR,
      });
    }

    let callback;
    try {
      callback = parseBorzoWebhookCallback(parsedBody);
    } catch (error) {
      throw new AppError("Webhook payload is invalid.", {
        statusCode: 400,
        code: ErrorCodes.VALIDATION_ERROR,
        cause: error,
      });
    }

    const receivedAt = new Date().toISOString();
    const normalizedEvent =
      mapBorzoWebhookCallbackToNormalizedEvent(callback, receivedAt);
    normalizedProviderWebhookEventSchema.parse(normalizedEvent);

    const providerEventKey = buildBorzoProviderEventKey(callback);
    const ids = extractBorzoWebhookIds(callback);
    const eventDatetime = new Date(callback.event_datetime);
    if (Number.isNaN(eventDatetime.getTime())) {
      throw new AppError("Webhook event datetime is invalid.", {
        statusCode: 400,
        code: ErrorCodes.VALIDATION_ERROR,
      });
    }

    let eventRecord;
    try {
      eventRecord = await this.repository.createReceivedEvent({
        providerCode: BORZO_PROVIDER_CODE,
        eventType: callback.event_type,
        providerEventKey,
        providerOrderId: ids.providerOrderId,
        providerDeliveryId: ids.providerDeliveryId,
        eventDatetime,
        signatureVerified: true,
        payloadHash: hashWebhookPayload(input.rawBody),
        payload: parsedBody,
        normalizedEvent,
      });
    } catch (error) {
      if (error instanceof ProviderWebhookDuplicateEventError) {
        logger.info(
          {
            requestId: input.requestId,
            providerCode: BORZO_PROVIDER_CODE,
            eventType: callback.event_type,
            providerOrderId: ids.providerOrderId,
            providerDeliveryId: ids.providerDeliveryId,
            duplicate: true,
          },
          "provider_webhook_duplicate",
        );
        return { received: true, duplicate: true };
      }
      throw error;
    }

    try {
      const processed = await this.processor.process({
        requestId: input.requestId,
        normalizedEvent,
      });
      await this.repository.markProcessed(eventRecord.id, {
        processingStatus: processed.processingStatus,
      });
    } catch (error) {
      const safeMessage =
        error instanceof Error ? error.message : "Webhook processing failed.";
      await this.repository.markProcessed(eventRecord.id, {
        processingStatus: "FAILED",
        processingError: safeMessage,
      });
      throw error;
    }

    logger.info(
      {
        requestId: input.requestId,
        providerCode: BORZO_PROVIDER_CODE,
        eventType: callback.event_type,
        providerOrderId: ids.providerOrderId,
        providerDeliveryId: ids.providerDeliveryId,
        duplicate: false,
      },
      "provider_webhook_received",
    );

    return { received: true, duplicate: false };
  }

  private readHeader(
    headers: Record<string, string | string[] | undefined>,
    name: string,
  ): string | undefined {
    const direct = headers[name];
    if (typeof direct === "string") {
      return direct;
    }
    const lower = headers[name.toLowerCase()];
    if (typeof lower === "string") {
      return lower;
    }
    if (Array.isArray(lower) && lower.length > 0) {
      return lower[0];
    }
    return undefined;
  }
}

export const borzoWebhookService = new BorzoWebhookService();
