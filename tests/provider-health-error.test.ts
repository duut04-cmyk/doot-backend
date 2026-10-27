import { describe, expect, it } from "vitest";
import {
  PROVIDER_HEALTH_CHECK_FAILED_MESSAGE,
  sanitizeProviderHealthCheckError,
} from "../src/modules/provider/provider-health-error.util.js";
import { toProviderSummaryDto } from "../src/modules/provider/provider.mapper.js";
import type { ProviderWithRelations } from "../src/modules/provider/provider.repository.js";

function minimalProvider(
  overrides: Partial<ProviderWithRelations> = {},
): ProviderWithRelations {
  const now = new Date();
  return {
    id: "00000000-0000-4000-8000-000000000001",
    code: "MOCK",
    name: "Mock",
    displayName: null,
    description: null,
    environment: "SANDBOX",
    status: "ACTIVE",
    enabled: true,
    orchestrationEnabled: false,
    priority: 100,
    integrationStatus: "NOT_CONFIGURED",
    healthStatus: "UNHEALTHY",
    lastHealthCheckAt: now,
    lastHealthCheckError: null,
    createdAt: now,
    updatedAt: now,
    settings: null,
    packageLimits: null,
    credentials: [],
    capabilities: [],
    services: [],
    vehicles: [],
    ...overrides,
  } as ProviderWithRelations;
}

describe("sanitizeProviderHealthCheckError", () => {
  it("returns null for absent or blank errors", () => {
    expect(sanitizeProviderHealthCheckError(null)).toBeNull();
    expect(sanitizeProviderHealthCheckError(undefined)).toBeNull();
    expect(sanitizeProviderHealthCheckError("   ")).toBeNull();
  });

  it("preserves the canonical safe failure message", () => {
    expect(sanitizeProviderHealthCheckError(PROVIDER_HEALTH_CHECK_FAILED_MESSAGE)).toBe(
      PROVIDER_HEALTH_CHECK_FAILED_MESSAGE,
    );
  });

  it("collapses unrecognized short vendor text to the safe default", () => {
    expect(sanitizeProviderHealthCheckError("Connection timed out after 30s")).toBe(
      PROVIDER_HEALTH_CHECK_FAILED_MESSAGE,
    );
    expect(
      sanitizeProviderHealthCheckError("Account acme-corp-99 disabled by vendor"),
    ).toBe(PROVIDER_HEALTH_CHECK_FAILED_MESSAGE);
  });

  it("redacts bearer tokens and credential-like content", () => {
    expect(
      sanitizeProviderHealthCheckError("HTTP 401: Bearer eyJhbGciOiJIUzI1NiJ9.payload"),
    ).toBe(PROVIDER_HEALTH_CHECK_FAILED_MESSAGE);
    expect(
      sanitizeProviderHealthCheckError("api_key=super-secret-key-value-here"),
    ).toBe(PROVIDER_HEALTH_CHECK_FAILED_MESSAGE);
    expect(
      sanitizeProviderHealthCheckError("Authorization: Basic dXNlcjpwYXNzd29yZA=="),
    ).toBe(PROVIDER_HEALTH_CHECK_FAILED_MESSAGE);
    expect(sanitizeProviderHealthCheckError("BEARER abcdefghijklmnop")).toBe(
      PROVIDER_HEALTH_CHECK_FAILED_MESSAGE,
    );
    expect(
      sanitizeProviderHealthCheckError("failed?access_token=secret-value-here"),
    ).toBe(PROVIDER_HEALTH_CHECK_FAILED_MESSAGE);
  });

  it("collapses multiline and long upstream errors", () => {
    expect(sanitizeProviderHealthCheckError("line1 ok\nline2 password=leak")).toBe(
      PROVIDER_HEALTH_CHECK_FAILED_MESSAGE,
    );
    expect(sanitizeProviderHealthCheckError("x".repeat(201))).toBe(
      PROVIDER_HEALTH_CHECK_FAILED_MESSAGE,
    );
  });
});

describe("provider mapper health.lastError", () => {
  it("sanitizes lastHealthCheckError in admin DTOs", () => {
    const dto = toProviderSummaryDto(
      minimalProvider({
        lastHealthCheckError: "password=leaked-from-upstream",
      }),
    );
    expect(dto.health.lastError).toBe(PROVIDER_HEALTH_CHECK_FAILED_MESSAGE);
  });
});
