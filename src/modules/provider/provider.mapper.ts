import type { ProviderCredentialField } from "@prisma/client";
import { PROVIDER_CREDENTIAL_FIELD_VALUES } from "./provider.constants.js";
import {
  mapPackageLimits,
  mapSettings,
  type ProviderWithRelations,
} from "./provider.repository.js";
import { providerAdapterRegistry } from "./adapters/provider-adapter-registry.js";
import {
  computeIntegrationStatusWithAdapter,
  isOrchestrationEligible,
} from "./provider.readiness.js";
import type {
  ProviderDetailDto,
  ProviderServiceDto,
  ProviderSummaryDto,
  ProviderVehicleDto,
} from "./provider.types.js";
import { decimalToNumber } from "../delivery/delivery.types.js";

function credentialMetadata(provider: ProviderWithRelations) {
  const activeFields = new Set(provider.credentials.map((c) => c.fieldName));
  const fields = PROVIDER_CREDENTIAL_FIELD_VALUES.map((name) => ({
    name: name as ProviderCredentialField,
    configured: activeFields.has(name as ProviderCredentialField),
  }));
  return {
    configured: activeFields.size > 0,
    fields,
  };
}

function mapService(service: ProviderWithRelations["services"][number]): ProviderServiceDto {
  return {
    id: service.id,
    code: service.code,
    name: service.name,
    serviceType: service.serviceType,
    description: service.description,
    enabled: service.enabled,
    priority: service.priority,
    createdAt: service.createdAt.toISOString(),
    updatedAt: service.updatedAt.toISOString(),
  };
}

function mapVehicle(vehicle: ProviderWithRelations["vehicles"][number]): ProviderVehicleDto {
  return {
    id: vehicle.id,
    vehicleType: vehicle.vehicleType,
    enabled: vehicle.enabled,
    maxWeightKg:
      vehicle.maxWeightKg == null ? null : decimalToNumber(vehicle.maxWeightKg),
    maxLengthCm:
      vehicle.maxLengthCm == null ? null : decimalToNumber(vehicle.maxLengthCm),
    maxWidthCm: vehicle.maxWidthCm == null ? null : decimalToNumber(vehicle.maxWidthCm),
    maxHeightCm:
      vehicle.maxHeightCm == null ? null : decimalToNumber(vehicle.maxHeightCm),
    createdAt: vehicle.createdAt.toISOString(),
    updatedAt: vehicle.updatedAt.toISOString(),
  };
}

export function toProviderSummaryDto(provider: ProviderWithRelations): ProviderSummaryDto {
  const integrationStatus = computeIntegrationStatusWithAdapter({
    provider,
    activeCredentials: provider.credentials,
    capabilities: provider.capabilities,
    adapterRegistered: providerAdapterRegistry.has(provider.code),
    healthStatus: provider.healthStatus,
  });

  return {
    id: provider.id,
    code: provider.code,
    name: provider.name,
    displayName: provider.displayName,
    environment: provider.environment,
    status: provider.status,
    enabled: provider.enabled,
    orchestrationEnabled: provider.orchestrationEnabled,
    priority: provider.priority,
    integrationStatus,
    orchestrationEligible: isOrchestrationEligible({
      enabled: provider.enabled,
      orchestrationEnabled: provider.orchestrationEnabled,
      integrationStatus,
      healthStatus: provider.healthStatus,
    }),
    health: {
      status: provider.healthStatus,
      lastCheckedAt: provider.lastHealthCheckAt?.toISOString() ?? null,
      lastError: provider.lastHealthCheckError,
    },
    credentials: credentialMetadata(provider),
    capabilities: provider.capabilities.map((item) => item.capability),
    createdAt: provider.createdAt.toISOString(),
    updatedAt: provider.updatedAt.toISOString(),
  };
}

export function toProviderDetailDto(provider: ProviderWithRelations): ProviderDetailDto {
  return {
    ...toProviderSummaryDto(provider),
    description: provider.description,
    settings: mapSettings(provider.settings),
    packageLimits: mapPackageLimits(provider.packageLimits),
    services: provider.services.map(mapService),
    vehicles: provider.vehicles.map(mapVehicle),
  };
}
