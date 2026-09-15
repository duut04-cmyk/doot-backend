import { z } from "zod";

export const cancellationOutcomeSchema = z.enum([
  "CANCELLED",
  "REJECTED",
  "UNKNOWN",
]);

export const cancellationRequestSchema = z.object({
  providerBookingId: z.string().min(1),
  reason: z.string().nullable().optional(),
});

export const normalizedCancellationResultSchema = z.object({
  success: z.boolean(),
  outcome: cancellationOutcomeSchema.optional(),
  providerCancellationId: z.string().nullable(),
  status: z.string(),
  reason: z.string().nullable(),
  cancelledAt: z.string().datetime().nullable(),
});

export type CancellationOutcome = z.infer<typeof cancellationOutcomeSchema>;
export type CancellationRequest = z.infer<typeof cancellationRequestSchema>;
export type NormalizedCancellationResult = z.infer<
  typeof normalizedCancellationResultSchema
>;
