import type { PlatformRuntimeSettingKey } from "@prisma/client";

/** Stable audit resource id for platform runtime setting mutations. */
export const PLATFORM_RUNTIME_SETTING_AUDIT_RESOURCE_ID =
  "00000000-0000-4000-8000-0000000000a0";

export const BOOKING_RUNTIME_SETTING_KEYS = [
  "BOOKING_QUOTE_MAX_AGE_SECONDS",
  "BOOKING_PRICE_TOLERANCE_PERCENT",
] as const satisfies readonly PlatformRuntimeSettingKey[];

export const PRICING_RUNTIME_SETTING_KEYS = [
  "PLATFORM_SERVICE_FEE_PERCENT",
] as const satisfies readonly PlatformRuntimeSettingKey[];

export const ALL_RUNTIME_SETTING_KEYS = [
  ...BOOKING_RUNTIME_SETTING_KEYS,
  ...PRICING_RUNTIME_SETTING_KEYS,
] as const satisfies readonly PlatformRuntimeSettingKey[];

export type BookingRuntimeSettingKey = (typeof BOOKING_RUNTIME_SETTING_KEYS)[number];
