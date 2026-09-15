import type {
  Provider,
  ProviderCapabilityRecord,
  ProviderCredential,
  ProviderHealthStatus,
  ProviderIntegrationStatus,
} from "@prisma/client";

/**
 * Phase 2 baseline: configuration-only readiness.
 * Phase 3: READY requires adapter registration + successful health — never faked for real providers.
 */
export function computeIntegrationStatus(input: {
  provider: Pick<Provider, "enabled">;
  activeCredentials: ProviderCredential[];
  capabilities: ProviderCapabilityRecord[];
}): ProviderIntegrationStatus {
  if (!input.provider.enabled) {
    return "NOT_CONFIGURED";
  }

  const hasCredentials = input.activeCredentials.length > 0;
  const hasCapabilities = input.capabilities.length > 0;

  if (hasCredentials && hasCapabilities) {
    return "CONFIGURED";
  }

  return "NOT_CONFIGURED";
}

export function canMarkProviderReady(input: {
  enabled: boolean;
  hasCredentials: boolean;
  hasCapabilities: boolean;
  adapterRegistered: boolean;
  healthStatus: ProviderHealthStatus;
}): boolean {
  return (
    input.enabled &&
    input.hasCredentials &&
    input.hasCapabilities &&
    input.adapterRegistered &&
    input.healthStatus === "HEALTHY"
  );
}

export function computeIntegrationStatusWithAdapter(input: {
  provider: Pick<Provider, "enabled">;
  activeCredentials: ProviderCredential[];
  capabilities: ProviderCapabilityRecord[];
  adapterRegistered: boolean;
  healthStatus: ProviderHealthStatus;
}): ProviderIntegrationStatus {
  const base = computeIntegrationStatus({
    provider: input.provider,
    activeCredentials: input.activeCredentials,
    capabilities: input.capabilities,
  });

  if (base === "NOT_CONFIGURED") {
    return "NOT_CONFIGURED";
  }

  if (
    canMarkProviderReady({
      enabled: input.provider.enabled,
      hasCredentials: input.activeCredentials.length > 0,
      hasCapabilities: input.capabilities.length > 0,
      adapterRegistered: input.adapterRegistered,
      healthStatus: input.healthStatus,
    })
  ) {
    return "READY";
  }

  return "CONFIGURED";
}

export function isOrchestrationEligible(input: {
  enabled: boolean;
  orchestrationEnabled: boolean;
  integrationStatus: ProviderIntegrationStatus;
  healthStatus: string;
}): boolean {
  return (
    input.enabled &&
    input.orchestrationEnabled &&
    input.integrationStatus === "READY" &&
    input.healthStatus !== "UNHEALTHY"
  );
}
