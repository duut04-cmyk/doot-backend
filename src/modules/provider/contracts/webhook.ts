import { z } from "zod";
import { normalizedDriverSchema } from "./common.js";
import { normalizedTrackingResultSchema } from "./tracking.js";

export const webhookParseRequestSchema = z.object({
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown(),
});

export const normalizedProviderWebhookEventSchema = z.object({
  providerCode: z.string(),
  providerEventId: z.string().nullable(),
  eventType: z.string(),
  providerReference: z.string().nullable(),
  providerBookingId: z.string().nullable(),
  status: z.string().nullable(),
  eventTimestamp: z.string().datetime().nullable(),
  receivedAt: z.string().datetime(),
  driver: normalizedDriverSchema.nullable(),
  tracking: normalizedTrackingResultSchema
    .pick({
      status: true,
      latitude: true,
      longitude: true,
      eta: true,
      trackingUrl: true,
    })
    .nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type WebhookParseRequest = z.infer<typeof webhookParseRequestSchema>;
export type NormalizedProviderWebhookEvent = z.infer<
  typeof normalizedProviderWebhookEventSchema
>;
