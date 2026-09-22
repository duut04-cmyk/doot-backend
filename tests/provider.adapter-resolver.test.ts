import { beforeEach, describe, expect, it } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { initializeProviderAdapters } from "../src/modules/provider/adapters/bootstrap.js";
import { MockProviderAdapter } from "../src/modules/provider/adapters/mock/mock-provider.adapter.js";
import { ProviderAdapterRegistry } from "../src/modules/provider/adapters/provider-adapter-registry.js";
import { ProviderAdapterResolver } from "../src/modules/provider/adapters/provider-adapter-resolver.js";
import { ProviderConfigResolver } from "../src/modules/provider/adapters/provider-config-resolver.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { seedMockProvider } from "./helpers/provider-adapter-test-helpers.js";

describe("Provider adapter resolver", () => {
  let repo: InMemoryProviderRepository;
  let registry: ProviderAdapterRegistry;
  let resolver: ProviderAdapterResolver;

  beforeEach(async () => {
    repo = new InMemoryProviderRepository();
    registry = new ProviderAdapterRegistry();
    registry.register(new MockProviderAdapter());
    resolver = new ProviderAdapterResolver(registry, new ProviderConfigResolver(repo));
  });

  it("resolves provider with adapter and config when ready", async () => {
    await seedMockProvider(repo, { integrationStatus: "READY" });
    const resolved = await resolver.resolveForExecution({
      providerCode: "MOCK",
      operation: "checkServiceability",
      requestId: "req-1",
    });
    expect(resolved.adapter.metadata.providerCode).toBe("MOCK");
    expect(resolved.config.providerCode).toBe("MOCK");
    expect(resolved.config.credentials.API_KEY).toBe("mock-api-key");
  });

  it("throws PROVIDER_NOT_FOUND for missing provider", async () => {
    await expect(
      resolver.resolveForExecution({
        providerCode: "MISSING",
        operation: "checkServiceability",
        requestId: "req-2",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.PROVIDER_NOT_FOUND,
    });
  });

  it("throws PROVIDER_DISABLED when provider is disabled", async () => {
    await seedMockProvider(repo, { enabled: false, integrationStatus: "READY" });
    await expect(
      resolver.resolveForExecution({
        providerCode: "MOCK",
        operation: "checkServiceability",
        requestId: "req-3",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.PROVIDER_DISABLED,
    });
  });

  it("throws PROVIDER_NOT_READY when not configured", async () => {
    await seedMockProvider(repo, { integrationStatus: "NOT_CONFIGURED" });
    await expect(
      resolver.resolveForExecution({
        providerCode: "MOCK",
        operation: "checkServiceability",
        requestId: "req-4",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.PROVIDER_NOT_READY,
    });
  });

  it("throws PROVIDER_ADAPTER_NOT_AVAILABLE when adapter missing", async () => {
    await seedMockProvider(repo, { integrationStatus: "READY" });
    const emptyRegistry = new ProviderAdapterRegistry();
    const noAdapterResolver = new ProviderAdapterResolver(
      emptyRegistry,
      new ProviderConfigResolver(repo),
    );
    await expect(
      noAdapterResolver.resolveForExecution({
        providerCode: "MOCK",
        operation: "checkServiceability",
        requestId: "req-5",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.PROVIDER_ADAPTER_NOT_AVAILABLE,
    });
  });

  it("throws PROVIDER_UNSUPPORTED_OPERATION for missing capability", async () => {
    await seedMockProvider(repo, {
      integrationStatus: "READY",
      capabilities: ["SERVICEABILITY"],
    });
    await expect(
      resolver.resolveForExecution({
        providerCode: "MOCK",
        operation: "getQuote",
        requestId: "req-6",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.PROVIDER_UNSUPPORTED_OPERATION,
    });
  });

  it("allows getTracking when LIVE_TRACKING is configured", async () => {
    await seedMockProvider(repo, {
      integrationStatus: "READY",
      capabilities: ["LIVE_TRACKING"],
    });
    const resolved = await resolver.resolveForExecution({
      providerCode: "MOCK",
      operation: "getTracking",
      requestId: "req-tracking-live",
    });
    expect(resolved.config.capabilities).toContain("LIVE_TRACKING");
  });

  it("allows getTracking when TRACKING_URL is configured", async () => {
    await seedMockProvider(repo, {
      integrationStatus: "READY",
      capabilities: ["TRACKING_URL"],
    });
    const resolved = await resolver.resolveForExecution({
      providerCode: "MOCK",
      operation: "getTracking",
      requestId: "req-tracking-url",
    });
    expect(resolved.config.capabilities).toContain("TRACKING_URL");
  });

  it("throws PROVIDER_UNSUPPORTED_OPERATION for getTracking without tracking capabilities", async () => {
    await seedMockProvider(repo, {
      integrationStatus: "READY",
      capabilities: ["BOOKING", "WEBHOOKS"],
    });
    await expect(
      resolver.resolveForExecution({
        providerCode: "MOCK",
        operation: "getTracking",
        requestId: "req-tracking-missing",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.PROVIDER_UNSUPPORTED_OPERATION,
    });
  });

  it("allows execution when requireReady is false and status is CONFIGURED", async () => {
    await seedMockProvider(repo, { integrationStatus: "CONFIGURED" });
    const resolved = await resolver.resolveForExecution({
      providerCode: "MOCK",
      operation: "checkServiceability",
      requestId: "req-7",
      requireReady: false,
    });
    expect(resolved.config.integrationStatus).toBe("CONFIGURED");
  });
});

describe("Provider adapter bootstrap", () => {
  it("registers mock adapter idempotently in test env", () => {
    const registry = new ProviderAdapterRegistry();
    initializeProviderAdapters(registry);
    initializeProviderAdapters(registry);
    expect(registry.has("MOCK")).toBe(true);
  });
});
