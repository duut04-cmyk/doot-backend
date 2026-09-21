import { z } from "zod";

export const cancellationFeeTypeSchema = z.enum([
  "NONE",
  "FIXED",
  "PERCENTAGE",
  "VARIABLE",
  "UNKNOWN",
]);

export const cancellationPolicySourceSchema = z.enum([
  "PROVIDER",
  "DUTT_CONFIG",
  "UNKNOWN",
]);

export const cancellationFeeSchema = z.object({
  type: cancellationFeeTypeSchema,
  amount: z.number().optional(),
  currency: z.string().optional(),
});

export const cancellationPolicySchema = z.object({
  supported: z.boolean(),
  allowedBeforePickup: z.boolean(),
  allowedAfterPickup: z.boolean(),
  fee: cancellationFeeSchema,
  conditions: z.array(z.string()),
  policyKnown: z.boolean(),
  source: cancellationPolicySourceSchema,
});

export const cancellationPolicyRequestSchema = z.object({
  deliveryId: z.string().min(1),
  deliveryReference: z.string().min(1),
  serviceCode: z.string().optional(),
  providerQuoteId: z.string().nullable().optional(),
});

export const cancellationPolicySnapshotSchema = cancellationPolicySchema.extend({
  capturedAt: z.string().datetime(),
});

export type CancellationFeeType = z.infer<typeof cancellationFeeTypeSchema>;
export type CancellationPolicySource = z.infer<
  typeof cancellationPolicySourceSchema
>;
export type CancellationFee = z.infer<typeof cancellationFeeSchema>;
export type CancellationPolicy = z.infer<typeof cancellationPolicySchema>;
export type CancellationPolicyRequest = z.infer<
  typeof cancellationPolicyRequestSchema
>;
export type CancellationPolicySnapshot = z.infer<
  typeof cancellationPolicySnapshotSchema
>;

export function unknownCancellationPolicy(): CancellationPolicy {
  return {
    supported: false,
    allowedBeforePickup: false,
    allowedAfterPickup: false,
    fee: { type: "UNKNOWN" },
    conditions: [],
    policyKnown: false,
    source: "UNKNOWN",
  };
}

export function toCancellationPolicySnapshot(
  policy: CancellationPolicy,
  capturedAt: Date = new Date(),
): CancellationPolicySnapshot {
  return {
    ...policy,
    capturedAt: capturedAt.toISOString(),
  };
}

export function isCancellationPolicyKnown(
  policy: CancellationPolicy,
): boolean {
  return policy.policyKnown === true;
}
