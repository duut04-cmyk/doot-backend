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
  auth: SettingsAuthPoliciesDto;
  deliveryOtp: SettingsDeliveryOtpPoliciesDto;
  orchestration: SettingsOrchestrationPoliciesDto;
};

export type SettingsFlagsDto = {
  mockProviderAdapter: boolean;
  developmentMode: boolean;
};

export type SettingsSnapshotDto = {
  platform: SettingsPlatformDto;
  policies: SettingsPoliciesDto;
  flags: SettingsFlagsDto;
  checkedAt: string;
};
