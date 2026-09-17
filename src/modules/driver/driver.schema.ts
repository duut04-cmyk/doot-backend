import { z } from "zod";
import { PROVIDER_VEHICLE_TYPE_VALUES } from "../provider/provider.constants.js";
import type { NormalizedDriver } from "../provider/contracts/common.js";

export const simulateDriverAssignmentBodySchema = z
  .object({
    status: z.literal("ASSIGNED"),
    providerDriverId: z.string().min(1),
    driverName: z.string().nullable().optional(),
    driverPhoneCountryCode: z.string().min(1).optional(),
    driverPhoneNumber: z.string().min(1).optional(),
    driverPhotoUrl: z.string().nullable().optional(),
    providerRating: z.number().min(0).max(5).nullable().optional(),
    vehicleType: z.enum(PROVIDER_VEHICLE_TYPE_VALUES).nullable().optional(),
    vehicleNumber: z.string().nullable().optional(),
  })
  .transform((body): NormalizedDriver => ({
    providerDriverId: body.providerDriverId,
    name: body.driverName ?? null,
    phone:
      body.driverPhoneCountryCode && body.driverPhoneNumber
        ? {
            countryCode: body.driverPhoneCountryCode,
            number: body.driverPhoneNumber,
          }
        : null,
    photoUrl: body.driverPhotoUrl ?? null,
    providerRating: body.providerRating ?? null,
    vehicleType: body.vehicleType ?? null,
    vehicleNumber: body.vehicleNumber ?? null,
    assignedAt: new Date().toISOString(),
  }));

export type SimulateDriverAssignmentBody = z.input<
  typeof simulateDriverAssignmentBodySchema
>;
