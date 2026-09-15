import type { ProviderCapability } from "@prisma/client";
import { isOrchestrationEligible } from "../provider/provider.readiness.js";
import type { ProviderWithRelations } from "../provider/provider.repository.js";
import { providerAdapterRegistry } from "../provider/adapters/provider-adapter-registry.js";
import {
  operationRequiresCapability,
} from "../provider/adapters/provider-adapter.capabilities.js";

export function isProviderBookingEligible(
  provider: ProviderWithRelations,
): boolean {
  if (provider.status !== "ACTIVE" || !provider.enabled) {
    return false;
  }

  if (
    !isOrchestrationEligible({
      enabled: provider.enabled,
      orchestrationEnabled: provider.orchestrationEnabled,
      integrationStatus: provider.integrationStatus,
      healthStatus: provider.healthStatus,
    })
  ) {
    return false;
  }

  if (!providerAdapterRegistry.has(provider.code)) {
    return false;
  }

  const configuredCapabilities = new Set(
    provider.capabilities.map((item) => item.capability),
  );

  if (
    !operationRequiresCapability("createBooking", configuredCapabilities)
  ) {
    return false;
  }

  const adapter = providerAdapterRegistry.resolve(provider.code);
  return adapter?.supportsOperation("createBooking") ?? false;
}

export function providerSupportsQuote(
  provider: ProviderWithRelations,
): boolean {
  const configuredCapabilities = new Set(
    provider.capabilities.map((item) => item.capability),
  );
  if (!configuredCapabilities.has("PRICING" as ProviderCapability)) {
    return false;
  }
  const adapter = providerAdapterRegistry.resolve(provider.code);
  return adapter?.supportsOperation("getQuote") ?? false;
}

export function validateSelectedService(input: {
  provider: ProviderWithRelations;
  providerServiceId: string | null;
  providerServiceCode: string | null;
}): { valid: boolean; serviceId: string | null; serviceCode: string | null } {
  if (input.providerServiceId) {
    const service = input.provider.services.find(
      (item) => item.id === input.providerServiceId,
    );
    if (!service || !service.enabled) {
      return { valid: false, serviceId: null, serviceCode: null };
    }
    return {
      valid: true,
      serviceId: service.id,
      serviceCode: service.code,
    };
  }

  if (input.providerServiceCode) {
    const service = input.provider.services.find(
      (item) => item.code === input.providerServiceCode && item.enabled,
    );
    if (!service) {
      return { valid: false, serviceId: null, serviceCode: null };
    }
    return {
      valid: true,
      serviceId: service.id,
      serviceCode: service.code,
    };
  }

  const enabled = input.provider.services
    .filter((service) => service.enabled)
    .sort((a, b) => a.priority - b.priority)[0];

  if (!enabled) {
    return { valid: false, serviceId: null, serviceCode: null };
  }

  return {
    valid: true,
    serviceId: enabled.id,
    serviceCode: enabled.code,
  };
}
