import { z } from "zod";
import {
  PACKAGE_TYPE_VALUES,
  PROVIDER_VEHICLE_TYPE_VALUES,
} from "../provider.constants.js";

export const normalizedLocationSchema = z.object({
  addressText: z.string().min(1),
  contactName: z.string().min(1),
  contactPhoneCountryCode: z.string().min(1),
  contactPhoneNumber: z.string().min(1),
  instructions: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
});

export const normalizedPhoneSchema = z
  .object({
    countryCode: z.string().min(1),
    number: z.string().min(1),
  })
  .nullable();

export const normalizedPackageSchema = z.object({
  packageType: z.enum(PACKAGE_TYPE_VALUES),
  weightKg: z.number().positive(),
  lengthCm: z.number().positive().nullable().optional(),
  widthCm: z.number().positive().nullable().optional(),
  heightCm: z.number().positive().nullable().optional(),
  quantity: z.number().int().positive(),
  description: z.string().nullable().optional(),
});

export const normalizedScheduleSchema = z.object({
  mode: z.enum(["ASAP", "SCHEDULED"]),
  timezone: z.string().min(1),
  scheduledAt: z.string().datetime().nullable().optional(),
  windowStart: z.string().datetime().nullable().optional(),
  windowEnd: z.string().datetime().nullable().optional(),
});

export const normalizedDriverSchema = z.object({
  providerDriverId: z.string().nullable(),
  name: z.string().nullable(),
  phone: normalizedPhoneSchema,
  photoUrl: z.string().nullable(),
  providerRating: z.number().nullable(),
  vehicleType: z.enum(PROVIDER_VEHICLE_TYPE_VALUES).nullable(),
  vehicleNumber: z.string().nullable(),
  assignedAt: z.string().datetime().nullable(),
});

export const moneyAmountSchema = z.object({
  amount: z.number().nonnegative(),
  currency: z.string().length(3),
});

export type NormalizedLocation = z.infer<typeof normalizedLocationSchema>;
export type NormalizedPhone = z.infer<typeof normalizedPhoneSchema>;
export type NormalizedPackage = z.infer<typeof normalizedPackageSchema>;
export type NormalizedSchedule = z.infer<typeof normalizedScheduleSchema>;
export type NormalizedDriver = z.infer<typeof normalizedDriverSchema>;
export type MoneyAmount = z.infer<typeof moneyAmountSchema>;
