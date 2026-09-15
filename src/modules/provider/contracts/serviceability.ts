import { z } from "zod";
import { PROVIDER_VEHICLE_TYPE_VALUES } from "../provider.constants.js";
import {
  normalizedLocationSchema,
  normalizedPackageSchema,
  normalizedScheduleSchema,
} from "./common.js";

export const serviceabilityRequestSchema = z.object({
  deliveryId: z.string().uuid().optional(),
  deliveryReference: z.string().optional(),
  pickup: normalizedLocationSchema,
  drop: normalizedLocationSchema,
  package: normalizedPackageSchema,
  schedule: normalizedScheduleSchema,
  requirements: z.array(z.string()),
  specialInstructions: z.string().nullable().optional(),
});

export const availableServiceSchema = z.object({
  serviceId: z.string().nullable(),
  serviceCode: z.string(),
  serviceName: z.string(),
  vehicleType: z.enum(PROVIDER_VEHICLE_TYPE_VALUES).nullable(),
  available: z.boolean(),
  packageCompatible: z.boolean(),
  estimatedPickupEta: z.string().datetime().nullable(),
  estimatedDeliveryEta: z.string().datetime().nullable(),
});

export const normalizedServiceabilityResultSchema = z.object({
  serviceable: z.boolean(),
  providerReference: z.string().nullable(),
  reason: z.string().nullable(),
  availableServices: z.array(availableServiceSchema),
  checkedAt: z.string().datetime(),
});

export type ServiceabilityRequest = z.infer<typeof serviceabilityRequestSchema>;
export type AvailableService = z.infer<typeof availableServiceSchema>;
export type NormalizedServiceabilityResult = z.infer<
  typeof normalizedServiceabilityResultSchema
>;
