import { randomUUID } from "node:crypto";
import type { ProviderWebhookProcessingStatus } from "@prisma/client";
import {
  ProviderWebhookDuplicateEventError,
  type IProviderWebhookEventRepository,
} from "../../src/modules/provider/provider.webhook.repository.js";
import type {
  CreateProviderWebhookEventInput,
  ProviderWebhookEventDto,
} from "../../src/modules/provider/provider.webhook.types.js";

export class InMemoryProviderWebhookEventRepository
  implements IProviderWebhookEventRepository
{
  events: ProviderWebhookEventDto[] = [];

  async createReceivedEvent(
    input: CreateProviderWebhookEventInput,
  ): Promise<ProviderWebhookEventDto> {
    const existing = await this.findByProviderEventKey(input.providerEventKey);
    if (existing) {
      throw new ProviderWebhookDuplicateEventError(existing);
    }

    const now = new Date();
    const event: ProviderWebhookEventDto = {
      id: randomUUID(),
      providerCode: input.providerCode,
      eventType: input.eventType,
      providerEventKey: input.providerEventKey,
      providerOrderId: input.providerOrderId,
      providerDeliveryId: input.providerDeliveryId,
      eventDatetime: input.eventDatetime,
      receivedAt: now,
      signatureVerified: input.signatureVerified,
      processingStatus: "RECEIVED",
      processedAt: null,
      processingError: null,
      payloadHash: input.payloadHash,
      payload: input.payload as ProviderWebhookEventDto["payload"],
      normalizedEvent: input.normalizedEvent as ProviderWebhookEventDto["normalizedEvent"],
      createdAt: now,
      updatedAt: now,
    };
    this.events.push(event);
    return event;
  }

  async findByProviderEventKey(
    providerEventKey: string,
  ): Promise<ProviderWebhookEventDto | null> {
    return (
      this.events.find((event) => event.providerEventKey === providerEventKey) ??
      null
    );
  }

  async markProcessed(
    eventId: string,
    input: {
      processingStatus: ProviderWebhookProcessingStatus;
      processingError?: string | null;
    },
  ): Promise<ProviderWebhookEventDto> {
    const event = this.events.find((item) => item.id === eventId);
    if (!event) {
      throw new Error("Webhook event not found.");
    }
    event.processingStatus = input.processingStatus;
    event.processingError = input.processingError ?? null;
    event.processedAt = new Date();
    event.updatedAt = new Date();
    return event;
  }
}
