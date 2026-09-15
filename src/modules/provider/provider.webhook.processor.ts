import { logger } from "../../config/logger.js";
import type { NormalizedProviderWebhookEvent } from "./contracts/webhook.js";
import {
  operationalWebhookHandler,
  type OperationalWebhookHandler,
} from "../operations/operational-webhook.handler.js";
import {
  prismaProviderDeliveryLinkResolver,
  type ProviderDeliveryLinkResolver,
} from "./provider.delivery-link.js";
import type { ProviderWebhookProcessResult } from "./provider.webhook.types.js";

export class ProviderWebhookProcessor {
  constructor(
    private readonly deliveryLinkResolver: ProviderDeliveryLinkResolver = prismaProviderDeliveryLinkResolver,
    private readonly operationalHandler: OperationalWebhookHandler = operationalWebhookHandler,
  ) {}

  async process(input: {
    requestId: string;
    normalizedEvent: NormalizedProviderWebhookEvent;
  }): Promise<ProviderWebhookProcessResult> {
    const metadata = input.normalizedEvent.metadata ?? {};
    const providerOrderId =
      typeof metadata.providerOrderId === "string"
        ? metadata.providerOrderId
        : input.normalizedEvent.providerBookingId;
    const providerDeliveryId =
      typeof metadata.providerDeliveryId === "string"
        ? metadata.providerDeliveryId
        : input.normalizedEvent.providerReference;

    const deliveryId = await this.deliveryLinkResolver.findDeliveryIdByProviderRefs(
      {
        providerCode: input.normalizedEvent.providerCode,
        providerOrderId,
        providerDeliveryId,
      },
    );

    if (!deliveryId) {
      logger.info(
        {
          requestId: input.requestId,
          providerCode: input.normalizedEvent.providerCode,
          providerOrderId,
          processingStatus: "IGNORED",
        },
        "provider_webhook_processed",
      );
      return { processingStatus: "IGNORED" };
    }

    const result = await this.operationalHandler.handle({
      requestId: input.requestId,
      deliveryId,
      normalizedEvent: input.normalizedEvent,
    });

    logger.info(
      {
        requestId: input.requestId,
        providerCode: input.normalizedEvent.providerCode,
        eventType: input.normalizedEvent.eventType,
        linkedDeliveryId: deliveryId,
        processingStatus: result,
      },
      "provider_webhook_processed",
    );

    return { processingStatus: result };
  }
}

export const providerWebhookProcessor = new ProviderWebhookProcessor();
