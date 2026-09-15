import { z } from "zod";
import { normalizedDriverSchema } from "./common.js";

export const trackingRequestSchema = z.object({
  providerBookingId: z.string().min(1),
  deliveryReference: z.string().optional(),
});

export const normalizedTrackingResultSchema = z.object({
  status: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  accuracyMeters: z.number().nonnegative().nullable(),
  providerTimestamp: z.string().datetime().nullable(),
  receivedAt: z.string().datetime(),
  eta: z.string().datetime().nullable(),
  trackingUrl: z.string().nullable(),
  driver: normalizedDriverSchema.nullable(),
  providerEventId: z.string().nullable(),
});

export type TrackingRequest = z.infer<typeof trackingRequestSchema>;
export type NormalizedTrackingResult = z.infer<typeof normalizedTrackingResultSchema>;
