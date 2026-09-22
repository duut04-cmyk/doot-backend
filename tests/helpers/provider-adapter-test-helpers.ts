import type { ProviderCapability } from "@prisma/client";
import { encryptCredential } from "../../src/modules/provider/provider.crypto.js";
import { MOCK_PROVIDER_CODE } from "../../src/modules/provider/adapters/mock/mock-provider.constants.js";
import type { InMemoryProviderRepository } from "./in-memory-provider-repository.js";

const DEFAULT_CAPABILITIES: ProviderCapability[] = [
  "SERVICEABILITY",
  "AVAILABILITY",
  "PRICING",
  "BOOKING",
  "CANCELLATION",
  "LIVE_TRACKING",
  "TRACKING_URL",
  "WEBHOOKS",
];

export async function seedMockProvider(
  repo: InMemoryProviderRepository,
  options?: {
    enabled?: boolean;
    integrationStatus?: "NOT_CONFIGURED" | "CONFIGURED" | "READY" | "ERROR";
    capabilities?: ProviderCapability[];
  },
): Promise<string> {
  const provider = await repo.createProvider({
    code: MOCK_PROVIDER_CODE,
    name: "Mock Test Provider",
    displayName: "Mock",
    description: "Test-only provider",
    environment: "SANDBOX",
    enabled: options?.enabled ?? true,
    orchestrationEnabled: false,
    priority: 10,
    integrationStatus: options?.integrationStatus ?? "READY",
    settings: {
      timeoutMs: 30000,
      connectTimeoutMs: 10000,
      maxRetries: 2,
      retryDelayMs: 1000,
      webhookEnabled: false,
      healthCheckEnabled: true,
      healthCheckIntervalMs: 300000,
    },
    capabilities: options?.capabilities ?? DEFAULT_CAPABILITIES,
  });

  const encrypted = encryptCredential("mock-api-key");
  await repo.createCredential({
    providerId: provider.id,
    fieldName: "API_KEY",
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
  });

  if (options?.integrationStatus) {
    await repo.updateProvider(provider.id, {
      integrationStatus: options.integrationStatus,
    });
  }

  return provider.id;
}

export async function seedOrchestrationMockProvider(
  repo: InMemoryProviderRepository,
  options?: {
    priority?: number;
    code?: string;
    orchestrationEnabled?: boolean;
    integrationStatus?: "NOT_CONFIGURED" | "CONFIGURED" | "READY" | "ERROR";
    healthStatus?: "UNKNOWN" | "HEALTHY" | "UNHEALTHY";
    capabilities?: ProviderCapability[];
    enabled?: boolean;
  },
): Promise<string> {
  const code = options?.code ?? MOCK_PROVIDER_CODE;
  const provider = await repo.createProvider({
    code,
    name: `Orchestration Provider ${code}`,
    displayName: code,
    description: "Orchestration test provider",
    environment: "SANDBOX",
    enabled: options?.enabled ?? true,
    orchestrationEnabled: options?.orchestrationEnabled ?? true,
    priority: options?.priority ?? 10,
    integrationStatus: options?.integrationStatus ?? "READY",
    settings: {
      timeoutMs: 30000,
      connectTimeoutMs: 10000,
      maxRetries: 2,
      retryDelayMs: 1000,
      webhookEnabled: false,
      healthCheckEnabled: true,
      healthCheckIntervalMs: 300000,
    },
    capabilities: options?.capabilities ?? DEFAULT_CAPABILITIES,
  });

  const encrypted = encryptCredential("mock-api-key");
  await repo.createCredential({
    providerId: provider.id,
    fieldName: "API_KEY",
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
  });

  await repo.updateProvider(provider.id, {
    integrationStatus: options?.integrationStatus ?? "READY",
    healthStatus: options?.healthStatus ?? "HEALTHY",
    orchestrationEnabled: options?.orchestrationEnabled ?? true,
  });

  await repo.createService({
    providerId: provider.id,
    code: "MOCK_BIKE",
    name: "Mock Bike Express",
    serviceType: "BIKE",
    description: null,
    enabled: true,
    priority: 10,
  });

  return provider.id;
}
