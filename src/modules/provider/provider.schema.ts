import { z } from "zod";
import { quoteRequestSchema } from "./contracts/quote.js";
import {
  MAX_CONNECT_TIMEOUT_MS,
  MAX_DIMENSION_CM,
  MAX_HEALTH_CHECK_INTERVAL_MS,
  MAX_PRIORITY,
  MAX_PROVIDER_DESCRIPTION_LENGTH,
  MAX_PROVIDER_DISPLAY_NAME_LENGTH,
  MAX_PROVIDER_NAME_LENGTH,
  MAX_RETRIES,
  MAX_RETRY_DELAY_MS,
  MAX_SERVICE_CODE_LENGTH,
  MAX_SERVICE_NAME_LENGTH,
  MAX_TIMEOUT_MS,
  MAX_VOLUME_CM3,
  MAX_WEIGHT_KG,
  MIN_CONNECT_TIMEOUT_MS,
  MIN_HEALTH_CHECK_INTERVAL_MS,
  MIN_PRIORITY,
  MIN_TIMEOUT_MS,
  PACKAGE_TYPE_VALUES,
  PROVIDER_CAPABILITY_VALUES,
  PROVIDER_CODE_REGEX,
  PROVIDER_CREDENTIAL_FIELD_VALUES,
  PROVIDER_SERVICE_TYPE_VALUES,
  PROVIDER_VEHICLE_TYPE_VALUES,
} from "./provider.constants.js";

const providerCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(PROVIDER_CODE_REGEX, "Provider code must be uppercase alphanumeric");

const positiveDecimal = (label: string, max: number) =>
  z.number().positive(`${label} must be positive`).max(max, `${label} is too large`);

const optionalPositiveDecimal = (_label: string, max: number) =>
  z.number().positive().max(max).nullable().optional();

export const providerIdParamsSchema = z.object({
  id: z.string().uuid("Invalid provider id"),
});

export const providerServiceParamsSchema = providerIdParamsSchema.extend({
  serviceId: z.string().uuid("Invalid service id"),
});

export const providerVehicleParamsSchema = providerIdParamsSchema.extend({
  vehicleId: z.string().uuid("Invalid vehicle id"),
});

const settingsSchema = z.object({
  timeoutMs: z.number().int().min(MIN_TIMEOUT_MS).max(MAX_TIMEOUT_MS).optional(),
  connectTimeoutMs: z
    .number()
    .int()
    .min(MIN_CONNECT_TIMEOUT_MS)
    .max(MAX_CONNECT_TIMEOUT_MS)
    .optional(),
  maxRetries: z.number().int().min(0).max(MAX_RETRIES).optional(),
  retryDelayMs: z.number().int().min(0).max(MAX_RETRY_DELAY_MS).optional(),
  webhookEnabled: z.boolean().optional(),
  healthCheckEnabled: z.boolean().optional(),
  healthCheckIntervalMs: z
    .number()
    .int()
    .min(MIN_HEALTH_CHECK_INTERVAL_MS)
    .max(MAX_HEALTH_CHECK_INTERVAL_MS)
    .optional(),
});

const packageLimitsSchema = z.object({
  minWeightKg: optionalPositiveDecimal("minWeightKg", MAX_WEIGHT_KG),
  maxWeightKg: optionalPositiveDecimal("maxWeightKg", MAX_WEIGHT_KG),
  maxLengthCm: optionalPositiveDecimal("maxLengthCm", MAX_DIMENSION_CM),
  maxWidthCm: optionalPositiveDecimal("maxWidthCm", MAX_DIMENSION_CM),
  maxHeightCm: optionalPositiveDecimal("maxHeightCm", MAX_DIMENSION_CM),
  maxVolumeCm3: optionalPositiveDecimal("maxVolumeCm3", MAX_VOLUME_CM3),
  supportedPackageTypes: z
    .array(z.enum(PACKAGE_TYPE_VALUES))
    .max(PACKAGE_TYPE_VALUES.length)
    .optional(),
});

export const createProviderSchema = z.object({
  code: providerCode,
  name: z.string().trim().min(1).max(MAX_PROVIDER_NAME_LENGTH),
  displayName: z
    .string()
    .trim()
    .max(MAX_PROVIDER_DISPLAY_NAME_LENGTH)
    .nullable()
    .optional(),
  description: z
    .string()
    .trim()
    .max(MAX_PROVIDER_DESCRIPTION_LENGTH)
    .nullable()
    .optional(),
  environment: z.enum(["SANDBOX", "LIVE"]).optional().default("SANDBOX"),
  enabled: z.boolean().optional().default(false),
  orchestrationEnabled: z.boolean().optional().default(false),
  priority: z.number().int().min(MIN_PRIORITY).max(MAX_PRIORITY).optional(),
  settings: settingsSchema.optional(),
  packageLimits: packageLimitsSchema.optional(),
  capabilities: z.array(z.enum(PROVIDER_CAPABILITY_VALUES)).optional().default([]),
});

export const updateProviderSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_PROVIDER_NAME_LENGTH).optional(),
    displayName: z
      .string()
      .trim()
      .max(MAX_PROVIDER_DISPLAY_NAME_LENGTH)
      .nullable()
      .optional(),
    description: z
      .string()
      .trim()
      .max(MAX_PROVIDER_DESCRIPTION_LENGTH)
      .nullable()
      .optional(),
    environment: z.enum(["SANDBOX", "LIVE"]).optional(),
    enabled: z.boolean().optional(),
    orchestrationEnabled: z.boolean().optional(),
    priority: z.number().int().min(MIN_PRIORITY).max(MAX_PRIORITY).optional(),
    settings: settingsSchema.optional(),
    packageLimits: packageLimitsSchema.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export const updateProviderStatusSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]),
  enabled: z.boolean().optional(),
});

export const upsertCredentialsSchema = z
  .object({
    API_KEY: z.string().min(1).max(512).optional(),
    API_SECRET: z.string().min(1).max(512).optional(),
    ACCESS_TOKEN: z.string().min(1).max(1024).optional(),
    CLIENT_ID: z.string().min(1).max(256).optional(),
    CLIENT_SECRET: z.string().min(1).max(512).optional(),
    USERNAME: z.string().min(1).max(128).optional(),
    PASSWORD: z.string().min(1).max(512).optional(),
    ACCOUNT_ID: z.string().min(1).max(128).optional(),
    WEBHOOK_SECRET: z.string().min(1).max(512).optional(),
  })
  .refine(
    (data) => Object.values(data).some((value) => value !== undefined),
    { message: "At least one credential field is required" },
  );

export const replaceCapabilitiesSchema = z.object({
  capabilities: z.array(z.enum(PROVIDER_CAPABILITY_VALUES)),
});

export const createProviderServiceSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1)
    .max(MAX_SERVICE_CODE_LENGTH)
    .regex(/^[A-Z0-9_]+$/, "Service code must be uppercase alphanumeric"),
  name: z.string().trim().min(1).max(MAX_SERVICE_NAME_LENGTH),
  serviceType: z.enum(PROVIDER_SERVICE_TYPE_VALUES),
  description: z.string().trim().max(500).nullable().optional(),
  enabled: z.boolean().optional().default(true),
  priority: z.number().int().min(MIN_PRIORITY).max(MAX_PRIORITY).optional(),
});

export const updateProviderServiceSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_SERVICE_NAME_LENGTH).optional(),
    serviceType: z.enum(PROVIDER_SERVICE_TYPE_VALUES).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    enabled: z.boolean().optional(),
    priority: z.number().int().min(MIN_PRIORITY).max(MAX_PRIORITY).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export const createProviderVehicleSchema = z.object({
  vehicleType: z.enum(PROVIDER_VEHICLE_TYPE_VALUES),
  enabled: z.boolean().optional().default(true),
  maxWeightKg: positiveDecimal("maxWeightKg", MAX_WEIGHT_KG).nullable().optional(),
  maxLengthCm: positiveDecimal("maxLengthCm", MAX_DIMENSION_CM).nullable().optional(),
  maxWidthCm: positiveDecimal("maxWidthCm", MAX_DIMENSION_CM).nullable().optional(),
  maxHeightCm: positiveDecimal("maxHeightCm", MAX_DIMENSION_CM).nullable().optional(),
});

export const updateProviderVehicleSchema = z
  .object({
    enabled: z.boolean().optional(),
    maxWeightKg: positiveDecimal("maxWeightKg", MAX_WEIGHT_KG).nullable().optional(),
    maxLengthCm: positiveDecimal("maxLengthCm", MAX_DIMENSION_CM).nullable().optional(),
    maxWidthCm: positiveDecimal("maxWidthCm", MAX_DIMENSION_CM).nullable().optional(),
    maxHeightCm: positiveDecimal("maxHeightCm", MAX_DIMENSION_CM).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export const providerTestQuoteBodySchema = quoteRequestSchema;

export type ProviderIdParams = z.infer<typeof providerIdParamsSchema>;
export type ProviderTestQuoteBody = z.infer<typeof providerTestQuoteBodySchema>;
export type ProviderServiceParams = z.infer<typeof providerServiceParamsSchema>;
export type ProviderVehicleParams = z.infer<typeof providerVehicleParamsSchema>;

export type CreateProviderBody = z.infer<typeof createProviderSchema>;
export type UpdateProviderBody = z.infer<typeof updateProviderSchema>;
export type UpdateProviderStatusBody = z.infer<typeof updateProviderStatusSchema>;
export type UpsertCredentialsBody = z.infer<typeof upsertCredentialsSchema>;
export type ReplaceCapabilitiesBody = z.infer<typeof replaceCapabilitiesSchema>;
export type CreateProviderServiceBody = z.infer<typeof createProviderServiceSchema>;
export type UpdateProviderServiceBody = z.infer<typeof updateProviderServiceSchema>;
export type CreateProviderVehicleBody = z.infer<typeof createProviderVehicleSchema>;
export type UpdateProviderVehicleBody = z.infer<typeof updateProviderVehicleSchema>;

export { PROVIDER_CREDENTIAL_FIELD_VALUES };
