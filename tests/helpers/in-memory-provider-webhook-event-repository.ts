import { randomUUID } from "node:crypto";
import type { ProviderWebhookProcessingStatus } from "@prisma/client";
import type { CreateProviderWebhookEventInput } from "../../src/modules/provider/provider.webhook.types.js";
import type { ProviderWebhookEventDto } from "../../src/modules/provider/provider.webhook.types.js";
import {
  formatProviderWebhookProcessingLease,
  PROVIDER_WEBHOOK_PROCESSING_LEASE_PREFIX,
  PROVIDER_WEBHOOK_PROCESSING_LEASE_STALE_MS,
  ProviderWebhookDuplicateEventError,
  ProviderWebhookLeaseConflictError,
  type IProviderWebhookEventRepository,
} from "../../src/modules/provider/provider.webhook.repository.js";

export class InMemoryProviderWebhookEventRepository implements IProviderWebhookEventRepository {
  events = new Map<string, ProviderWebhookEventDto>();

  async createReceivedEvent(
    input: CreateProviderWebhookEventInput,
  ): Promise<ProviderWebhookEventDto> {
    const existing = this.events.get(input.providerEventKey);
    if (existing) {
      throw new ProviderWebhookDuplicateEventError(existing);
    }
    const row: ProviderWebhookEventDto = {
      id: randomUUID(),
      providerCode: input.providerCode,
      eventType: input.eventType,
      providerEventKey: input.providerEventKey,
      providerOrderId: input.providerOrderId,
      providerDeliveryId: input.providerDeliveryId,
      eventDatetime: input.eventDatetime,
      receivedAt: new Date(),
      signatureVerified: input.signatureVerified,
      processingStatus: "RECEIVED",
      processedAt: null,
      processingError: null,
      payloadHash: input.payloadHash,
      payload: input.payload as ProviderWebhookEventDto["payload"],
      normalizedEvent:
        input.normalizedEvent as ProviderWebhookEventDto["normalizedEvent"],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.events.set(input.providerEventKey, row);
    return row;
  }

  async findByProviderEventKey(
    providerEventKey: string,
  ): Promise<ProviderWebhookEventDto | null> {
    return this.events.get(providerEventKey) ?? null;
  }

  async tryAcquireProcessingLease(input: {
    eventId: string;
    leaseToken: string;
  }): Promise<boolean> {
    const row = [...this.events.values()].find((item) => item.id === input.eventId);
    if (!row || row.processingStatus !== "RECEIVED") {
      return false;
    }
    const leaseValue = formatProviderWebhookProcessingLease(input.leaseToken);
    if (row.processingError == null) {
      const updated: ProviderWebhookEventDto = {
        ...row,
        processingError: leaseValue,
        updatedAt: new Date(),
      };
      this.events.set(updated.providerEventKey, updated);
      return true;
    }
    if (
      row.processingError.startsWith(PROVIDER_WEBHOOK_PROCESSING_LEASE_PREFIX) &&
      row.updatedAt.getTime() < Date.now() - PROVIDER_WEBHOOK_PROCESSING_LEASE_STALE_MS
    ) {
      const updated: ProviderWebhookEventDto = {
        ...row,
        processingError: leaseValue,
        updatedAt: new Date(),
      };
      this.events.set(updated.providerEventKey, updated);
      return true;
    }
    return false;
  }

  async markProcessed(
    eventId: string,
    input: {
      processingStatus: ProviderWebhookProcessingStatus;
      processingError?: string | null;
      leaseToken?: string | null;
    },
  ): Promise<ProviderWebhookEventDto> {
    const row = [...this.events.values()].find((item) => item.id === eventId);
    if (!row) {
      throw new Error("Provider webhook event not found");
    }

    if (input.leaseToken) {
      const expectedLease = formatProviderWebhookProcessingLease(input.leaseToken);
      if (
        row.processingStatus !== "RECEIVED" ||
        row.processingError !== expectedLease
      ) {
        throw new ProviderWebhookLeaseConflictError();
      }
    } else if (row.processingStatus !== "FAILED") {
      throw new ProviderWebhookLeaseConflictError();
    }

    const updated: ProviderWebhookEventDto = {
      ...row,
      processingStatus: input.processingStatus,
      processingError: input.processingError ?? null,
      processedAt: new Date(),
      updatedAt: new Date(),
    };
    this.events.set(updated.providerEventKey, updated);
    return updated;
  }
}
