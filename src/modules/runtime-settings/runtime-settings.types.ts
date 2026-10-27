import type { PlatformRuntimeSettingKey } from "@prisma/client";

export type RuntimeSettingSource = "env" | "database";

export type RuntimeSettingState = {
  value: number;
  source: RuntimeSettingSource;
  version: number;
  restartRequired: false;
  /** Set when a DB row exists but stored intValue failed validation; effective value is env. */
  invalidStoredOverride?: true;
  /** Set when the persisted store could not be read; effective value is env default. */
  storageUnavailable?: true;
};

export type BookingRuntimeSettings = {
  quoteMaxAgeSeconds: number;
  priceTolerancePercent: number;
};

export type BookingRuntimeSettingStates = {
  quoteMaxAgeSeconds: RuntimeSettingState;
  priceTolerancePercent: RuntimeSettingState;
};

export type PricingRuntimeSettings = {
  platformServiceFeePercent: number;
};

export type PricingRuntimeSettingStates = {
  platformServiceFeePercent: RuntimeSettingState;
};

export type PlatformRuntimeSettingRecord = {
  key: PlatformRuntimeSettingKey;
  intValue: number;
  version: number;
  updatedByUserId: string;
  updatedAt: Date;
};

export type RuntimeSettingChange = {
  key: PlatformRuntimeSettingKey;
  previousValue: number;
  newValue: number;
  previousVersion: number;
  newVersion: number;
};

export type PatchBookingPoliciesAuditOutcome = {
  outcome: "updated" | "no_change";
  changes: RuntimeSettingChange[];
};
