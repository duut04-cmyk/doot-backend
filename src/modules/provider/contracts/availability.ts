import { z } from "zod";
import { normalizedDriverSchema } from "./common.js";
import { serviceabilityRequestSchema } from "./serviceability.js";

export const availabilityRequestSchema = serviceabilityRequestSchema.extend({
  serviceCode: z.string().optional(),
});

export const availabilityResultSchema = z.object({
  /**
   * When false, driver availability was not established by the provider operation.
   * Consumers must not treat `available` as known unavailability in that case.
   */
  known: z.boolean(),
  available: z.boolean(),
  availableDriverCount: z.number().int().nonnegative().nullable(),
  drivers: z.array(normalizedDriverSchema).nullable(),
  checkedAt: z.string().datetime(),
  reason: z.string().nullable(),
});

export type AvailabilityRequest = z.infer<typeof availabilityRequestSchema>;
export type AvailabilityResult = z.infer<typeof availabilityResultSchema>;
