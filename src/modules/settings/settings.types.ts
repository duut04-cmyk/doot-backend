export type SettingsPlatformDto = {
  appName: string;
  nodeEnv: string;
  port: number;
  frontendUrl: string | null;
  adminFrontendUrl: string | null;
};

export type SettingsBookingPoliciesDto = {
  quoteMaxAgeSeconds: number;
  priceTolerancePercent: number;
};

export type SettingsPricingPoliciesDto = {
  platformServiceFeePercent: number;
};

export type SettingsAuthPoliciesDto = {
  jwtAccessExpiresIn: string;
  refreshTokenExpiresInDays: number;
  bcryptRounds: number;
  passwordResetTokenExpirySeconds: number;
  emailVerificationOtpExpiryMinutes: number;
  otpResendCooldownSeconds: number;
};

export type SettingsDeliveryOtpPoliciesDto = {
  expirySeconds: number;
  maxAttempts: number;
  generationCooldownSeconds: number;
};

export type SettingsOrchestrationPoliciesDto = {
  requireKnownCancellationPolicy: boolean;
  scoreWeights: {
    price: number;
    eta: number;
    availability: number;
    providerPriority: number;
    serviceQuality: number;
  };
};

export type SettingsPoliciesDto = {
  booking: SettingsBookingPoliciesDto;
  pricing: SettingsPricingPoliciesDto;
  auth: SettingsAuthPoliciesDto;
  deliveryOtp: SettingsDeliveryOtpPoliciesDto;
  orchestration: SettingsOrchestrationPoliciesDto;
};

export type SettingsFlagsDto = {
  mockProviderAdapter: boolean;
  developmentMode: boolean;
};

export type RuntimeSettingMetaDto = {
  value: number;
  source: "env" | "database";
  version: number;
  restartRequired: false;
  invalidStoredOverride?: true;
  storageUnavailable?: true;
};

export type SettingsRuntimeBookingDto = {
  quoteMaxAgeSeconds: RuntimeSettingMetaDto;
  priceTolerancePercent: RuntimeSettingMetaDto;
};

export type SettingsRuntimePricingDto = {
  platformServiceFeePercent: RuntimeSettingMetaDto;
};

export type SettingsRuntimeDto = {
  booking: SettingsRuntimeBookingDto;
  pricing: SettingsRuntimePricingDto;
};

export type PatchBookingPoliciesResponseDto = {
  booking: SettingsRuntimeBookingDto;
  pricing: SettingsRuntimePricingDto;
  audit: {
    outcome: "updated" | "no_change";
    changes: Array<{
      key: string;
      previousValue: number;
      newValue: number;
      previousVersion: number;
      newVersion: number;
    }>;
  };
};

export type SettingsSnapshotDto = {
  platform: SettingsPlatformDto;
  policies: SettingsPoliciesDto;
  flags: SettingsFlagsDto;
  runtime: SettingsRuntimeDto;
  checkedAt: string;
};
