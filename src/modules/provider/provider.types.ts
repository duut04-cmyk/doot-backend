import type {
  AdminAuditAction,
  AdminAuditResourceType,
  PackageType,
  ProviderCapability,
  ProviderCredentialField,
  ProviderEnvironment,
  ProviderHealthStatus,
  ProviderIntegrationStatus,
  ProviderServiceType,
  ProviderStatus,
  ProviderVehicleType,
} from "@prisma/client";

export type ProviderSettingsDto = {
  timeoutMs: number;
  connectTimeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  webhookEnabled: boolean;
  healthCheckEnabled: boolean;
  healthCheckIntervalMs: number;
};

export type ProviderPackageLimitsDto = {
  minWeightKg: number | null;
  maxWeightKg: number | null;
  maxLengthCm: number | null;
  maxWidthCm: number | null;
  maxHeightCm: number | null;
  maxVolumeCm3: number | null;
  supportedPackageTypes: PackageType[];
};

export type ProviderCredentialMetadataDto = {
  configured: boolean;
  fields: Array<{ name: ProviderCredentialField; configured: boolean }>;
};

export type ProviderHealthDto = {
  status: ProviderHealthStatus;
  lastCheckedAt: string | null;
  lastError: string | null;
};

export type ProviderServiceDto = {
  id: string;
  code: string;
  name: string;
  serviceType: ProviderServiceType;
  description: string | null;
  enabled: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
};

export type ProviderVehicleDto = {
  id: string;
  vehicleType: ProviderVehicleType;
  enabled: boolean;
  maxWeightKg: number | null;
  maxLengthCm: number | null;
  maxWidthCm: number | null;
  maxHeightCm: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ProviderSummaryDto = {
  id: string;
  code: string;
  name: string;
  displayName: string | null;
  environment: ProviderEnvironment;
  status: ProviderStatus;
  enabled: boolean;
  orchestrationEnabled: boolean;
  priority: number;
  integrationStatus: ProviderIntegrationStatus;
  orchestrationEligible: boolean;
  health: ProviderHealthDto;
  credentials: ProviderCredentialMetadataDto;
  capabilities: ProviderCapability[];
  createdAt: string;
  updatedAt: string;
};

export type ProviderDetailDto = ProviderSummaryDto & {
  description: string | null;
  settings: ProviderSettingsDto;
  packageLimits: ProviderPackageLimitsDto | null;
  services: ProviderServiceDto[];
  vehicles: ProviderVehicleDto[];
};

export type AuditContext = {
  adminUserId: string;
  requestId: string;
};

export type SafeAuditMetadata = Record<string, unknown>;

export type CreateAuditInput = {
  action: AdminAuditAction;
  resourceType: AdminAuditResourceType;
  resourceId: string;
  metadata?: SafeAuditMetadata;
} & AuditContext;
