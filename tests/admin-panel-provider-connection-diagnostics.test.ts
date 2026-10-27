import { describe, expect, it } from "vitest";
import type { ProviderDetail } from "../../admin-panel/src/data/providerTypes.ts";
import {
  connectionTestResultOmitsSecrets,
  isTestConnectionActionAvailable,
  isTestConnectionAllowedForEnvironment,
  sanitizeTestConnectionError,
  testConnectionDisabledReason,
} from "../../admin-panel/src/providers/providerConnectionDiagnostics.ts";

const baseProvider: ProviderDetail = {
  id: "00000000-0000-4000-8000-000000000010",
  code: "MOCK",
  name: "Mock Provider",
  displayName: "Mock",
  description: null,
  environment: "SANDBOX",
  status: "ACTIVE",
  enabled: true,
  orchestrationEnabled: false,
  priority: 100,
  integrationStatus: "CONFIGURED",
  orchestrationEligible: false,
  health: { status: "UNKNOWN", lastCheckedAt: null, lastError: null },
  credentials: { configured: true, fields: [{ name: "API_KEY", configured: true }] },
  capabilities: ["BOOKING"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  settings: {
    timeoutMs: 30000,
    connectTimeoutMs: 10000,
    maxRetries: 2,
    retryDelayMs: 1000,
    webhookEnabled: false,
    healthCheckEnabled: true,
    healthCheckIntervalMs: 300000,
  },
  packageLimits: null,
  services: [],
  vehicles: [],
};

describe("admin-panel provider connection diagnostics", () => {
  it("allows test connection only in SANDBOX", () => {
    expect(isTestConnectionAllowedForEnvironment("SANDBOX")).toBe(true);
    expect(isTestConnectionAllowedForEnvironment("LIVE")).toBe(false);
  });

  it("disables LIVE providers with an explicit policy message", () => {
    const live = { ...baseProvider, environment: "LIVE" as const };
    expect(isTestConnectionActionAvailable(live)).toBe(false);
    expect(testConnectionDisabledReason(live)).toMatch(/Live providers/);
  });

  it("requires provider to be enabled and configured", () => {
    expect(
      isTestConnectionActionAvailable({
        ...baseProvider,
        enabled: false,
      }),
    ).toBe(false);
    expect(
      isTestConnectionActionAvailable({
        ...baseProvider,
        integrationStatus: "NOT_CONFIGURED",
      }),
    ).toBe(false);
  });

  it("sanitizes unsafe connection test errors", () => {
    expect(sanitizeTestConnectionError("Provider is not configured.")).toContain(
      "not configured",
    );
    expect(
      sanitizeTestConnectionError("Bearer eyJhbGciOiJIUzI1NiJ9.secret.payload"),
    ).toBe("Connection test failed.");
  });

  it("treats connection test results as non-secret payloads", () => {
    const result = {
      providerCode: "MOCK",
      environment: "SANDBOX",
      connected: true,
      latencyMs: 42,
    };
    expect(connectionTestResultOmitsSecrets(result)).toBe(true);
  });
});
