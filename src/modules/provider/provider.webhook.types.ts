import type {
  ProviderWebhookProcessingStatus,
  ProviderWebhookEvent as ProviderWebhookEventRecord,
} from "@prisma/client";
import type { NormalizedProviderWebhookEvent } from "./contracts/webhook.js";

export type CreateProviderWebhookEventInput = {
  providerCode: string;
  eventType: string;
  providerEventKey: string;
  providerOrderId: string | null;
  providerDeliveryId: string | null;
  eventDatetime: Date;
  signatureVerified: boolean;
  payloadHash: string;
  payload: unknown;
  normalizedEvent: NormalizedProviderWebhookEvent;
};

export type ProviderWebhookEventDto = ProviderWebhookEventRecord;

export type ProviderWebhookIngestResult = {
  received: true;
  duplicate: boolean;
  eventId: string;
};

export type ProviderWebhookProcessResult = {
  processingStatus: ProviderWebhookProcessingStatus;
};

export { ProviderWebhookProcessingStatus };
