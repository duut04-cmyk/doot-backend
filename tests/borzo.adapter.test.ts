import { describe, expect, it, vi } from "vitest";
import { BorzoAdapter } from "../src/modules/provider/adapters/borzo/borzo.adapter.js";
import { BorzoClient } from "../src/modules/provider/adapters/borzo/borzo.client.js";
import { BORZO_PROVIDER_CODE } from "../src/modules/provider/adapters/borzo/borzo.constants.js";
import { ProviderAdapterRegistry } from "../src/modules/provider/adapters/provider-adapter-registry.js";
import { ProviderAdapterResolver } from "../src/modules/provider/adapters/provider-adapter-resolver.js";
import { ProviderConfigResolver } from "../src/modules/provider/adapters/provider-config-resolver.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import {
  seedBorzoProvider,
  seedMockProvider,
} from "./helpers/provider-adapter-test-helpers.js";
import {
  sampleQuoteRequest,
  successfulBorzoCalculateOrderResponse,
} from "./helpers/borzo-test-fixtures.js";
import type { ProviderRuntimeConfig } from "../src/modules/provider/adapters/provider-config.types.js";
import { BORZO_TEST_BASE_URL } from "../src/modules/provider/adapters/borzo/borzo.constants.js";

describe("Borzo adapter registration", () => {
  it("registers and resolves BORZO adapter", () => {
    const registry = new ProviderAdapterRegistry();
    registry.register(new BorzoAdapter());
    expect(registry.has(BORZO_PROVIDER_CODE)).toBe(true);
    expect(registry.resolve(BORZO_PROVIDER_CODE)?.metadata.providerCode).toBe(
      "BORZO",
    );
  });

  it("resolver finds BORZO when configured", async () => {
    const repo = new InMemoryProviderRepository();
    await seedBorzoProvider(repo, { integrationStatus: "CONFIGURED" });
    const registry = new ProviderAdapterRegistry();
    registry.register(new BorzoAdapter());
    const resolver = new ProviderAdapterResolver(
      registry,
      new ProviderConfigResolver(repo),
    );
    const resolved = await resolver.resolveByIdForExecution({
      providerId: (await repo.findByCode("BORZO"))!.id,
      operation: "getQuote",
      requestId: "req-reg-1",
      requireReady: false,
    });
    expect(resolved.adapter.metadata.providerCode).toBe("BORZO");
  });

  it("keeps MOCK adapter working independently", async () => {
    const { MockProviderAdapter } = await import(
      "../src/modules/provider/adapters/mock/mock-provider.adapter.js"
    );
    const repo = new InMemoryProviderRepository();
    await seedMockProvider(repo, { integrationStatus: "READY" });
    const registry = new ProviderAdapterRegistry();
    registry.register(new BorzoAdapter());
    registry.register(new MockProviderAdapter());
    const resolver = new ProviderAdapterResolver(
      registry,
      new ProviderConfigResolver(repo),
    );
    const resolved = await resolver.resolveForExecution({
      providerCode: "MOCK",
      operation: "getQuote",
      requestId: "req-reg-2",
    });
    expect(resolved.adapter.metadata.providerCode).toBe("MOCK");
  });
});

describe("Borzo adapter execution", () => {
  const config: ProviderRuntimeConfig = {
    providerId: "11111111-1111-1111-1111-111111111111",
    providerCode: "BORZO",
    environment: "SANDBOX",
    status: "ACTIVE",
    enabled: true,
    integrationStatus: "CONFIGURED",
    baseUrl: BORZO_TEST_BASE_URL,
    timeoutMs: 5000,
    connectTimeoutMs: 5000,
    maxRetries: 0,
    retryDelayMs: 1000,
    capabilities: ["PRICING", "SERVICEABILITY"],
    services: [],
    credentials: { ACCESS_TOKEN: "secret-borzo-token" },
  };

  it("executes getQuote via calculate-order", async () => {
    const calculateOrder = vi
      .fn()
      .mockResolvedValue(successfulBorzoCalculateOrderResponse);
    const adapter = new BorzoAdapter({
      calculateOrder,
      ping: vi.fn(),
    } as unknown as BorzoClient);

    const quote = await adapter.execute("getQuote", sampleQuoteRequest, {
      requestId: "req-exec-1",
      config,
    });
    expect(quote.available).toBe(true);
    expect(quote.amount?.amount).toBe(170);
    expect(calculateOrder).toHaveBeenCalledOnce();
  });

  it("probeQuote returns combined normalized result", async () => {
    const calculateOrder = vi
      .fn()
      .mockResolvedValue(successfulBorzoCalculateOrderResponse);
    const adapter = new BorzoAdapter({
      calculateOrder,
      ping: vi.fn(),
    } as unknown as BorzoClient);

    const result = await adapter.probeQuote(sampleQuoteRequest, {
      requestId: "req-exec-2",
      config,
    });
    expect(result.providerCode).toBe("BORZO");
    expect(result.quote.amount?.amount).toBe(170);
    expect(result.serviceability.serviceable).toBe(true);
    expect(result.availability.known).toBe(false);
    expect(result.availability.available).toBe(false);
  });

  it("rejects unsupported operations", async () => {
    const adapter = new BorzoAdapter();
    await expect(
      adapter.execute(
        "createBooking",
        {
          ...sampleQuoteRequest,
          serviceCode: "BORZO_BIKE",
        },
        { requestId: "req-exec-3", config },
      ),
    ).rejects.toMatchObject({
      category: "PROVIDER_UNSUPPORTED_OPERATION",
    });
  });
});
