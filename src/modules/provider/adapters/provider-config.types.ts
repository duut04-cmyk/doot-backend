import type {
  ProviderCapability,
  ProviderCredentialField,
  ProviderEnvironment,
  ProviderIntegrationStatus,
  ProviderStatus,
} from "@prisma/client";

export type ProviderRuntimeService = {
  id: string;
  code: string;
  name: string;
  serviceType: string;
  enabled: boolean;
  priority: number;
};

export type ProviderRuntimeConfig = {
  providerId: string;
  providerCode: string;
  environment: ProviderEnvironment;
  status: ProviderStatus;
  enabled: boolean;
  integrationStatus: ProviderIntegrationStatus;
  baseUrl: string;
  timeoutMs: number;
  connectTimeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  capabilities: ProviderCapability[];
  services: ProviderRuntimeService[];
  credentials: Partial<Record<ProviderCredentialField, string>>;
};
