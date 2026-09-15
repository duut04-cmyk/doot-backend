import { z } from "zod";
import { moneyAmountSchema, normalizedDriverSchema } from "./common.js";
import { quoteRequestSchema } from "./quote.js";

export const bookingOutcomeSchema = z.enum(["BOOKED", "FAILED", "UNKNOWN"]);

export const bookingRequestSchema = quoteRequestSchema.extend({
  providerQuoteId: z.string().nullable().optional(),
  idempotencyKey: z.string().min(1).optional(),
});

export const bookingServiceInfoSchema = z.object({
  serviceCode: z.string(),
  serviceName: z.string().nullable(),
  vehicleType: z.string().nullable(),
});

export const normalizedBookingResultSchema = z.object({
  success: z.boolean(),
  outcome: bookingOutcomeSchema.optional(),
  providerBookingId: z.string().nullable(),
  providerReference: z.string().nullable(),
  status: z.string(),
  bookedAt: z.string().datetime().nullable(),
  estimatedPickupAt: z.string().datetime().nullable(),
  estimatedDeliveryAt: z.string().datetime().nullable(),
  trackingUrl: z.string().nullable(),
  driver: normalizedDriverSchema.nullable(),
  service: bookingServiceInfoSchema.nullable(),
  amount: moneyAmountSchema.nullable().optional(),
  reason: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type BookingRequest = z.infer<typeof bookingRequestSchema>;
export type BookingOutcome = z.infer<typeof bookingOutcomeSchema>;
export type NormalizedBookingResult = z.infer<typeof normalizedBookingResultSchema>;
