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
  sampleBookingRequest,
  sampleQuoteRequest,
  successfulBorzoCalculateOrderResponse,
  successfulBorzoCancelOrderResponse,
  successfulBorzoCourierResponse,
  successfulBorzoCreateOrderResponse,
  successfulBorzoOrdersListResponse,
} from "./helpers/borzo-test-fixtures.js";
import type { ProviderRuntimeConfig } from "../src/modules/provider/adapters/provider-config.types.js";
import { BORZO_TEST_BASE_URL } from "../src/modules/provider/adapters/borzo/borzo.constants.js";

describe("Borzo adapter registration", () => {
  it("registers and resolves BORZO adapter", () => {
    const registry = new ProviderAdapterRegistry();
    registry.register(new BorzoAdapter());
    expect(registry.has(BORZO_PROVIDER_CODE)).toBe(true);
    expect(registry.resolve(BORZO_PROVIDER_CODE)?.metadata.providerCode).toBe("BORZO");
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
    const { MockProviderAdapter } =
      await import("../src/modules/provider/adapters/mock/mock-provider.adapter.js");
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

  it("executes createBooking via create-order", async () => {
    const createOrder = vi.fn().mockResolvedValue(successfulBorzoCreateOrderResponse);
    const adapter = new BorzoAdapter({
      createOrder,
      ping: vi.fn(),
    } as unknown as BorzoClient);

    const booking = await adapter.execute("createBooking", sampleBookingRequest, {
      requestId: "req-exec-3",
      config: { ...config, capabilities: [...config.capabilities, "BOOKING"] },
    });
    expect(booking.success).toBe(true);
    expect(booking.providerBookingId).toBe("1250100");
    expect(createOrder).toHaveBeenCalledOnce();
  });

  it("executes getTracking with courier and order lookup", async () => {
    const getCourier = vi.fn().mockResolvedValue(successfulBorzoCourierResponse);
    const getOrder = vi.fn().mockResolvedValue(successfulBorzoOrdersListResponse);
    const adapter = new BorzoAdapter({
      getCourier,
      getOrder,
      ping: vi.fn(),
    } as unknown as BorzoClient);

    const tracking = await adapter.execute(
      "getTracking",
      { providerBookingId: "1250100" },
      {
        requestId: "req-exec-4",
        config: { ...config, capabilities: [...config.capabilities, "LIVE_TRACKING"] },
      },
    );
    expect(tracking.latitude).toBe(12.9716);
    expect(tracking.driver?.providerDriverId).toBe("9001");
    expect(getCourier).toHaveBeenCalledOnce();
    expect(getOrder).toHaveBeenCalledOnce();
  });

  it("executes cancelBooking via cancel-order", async () => {
    const cancelOrder = vi.fn().mockResolvedValue(successfulBorzoCancelOrderResponse);
    const adapter = new BorzoAdapter({
      cancelOrder,
      ping: vi.fn(),
    } as unknown as BorzoClient);

    const result = await adapter.execute(
      "cancelBooking",
      { providerBookingId: "1250100", reason: "Customer request" },
      {
        requestId: "req-exec-5",
        config: { ...config, capabilities: [...config.capabilities, "CANCELLATION"] },
      },
    );
    expect(result.success).toBe(true);
    expect(result.outcome).toBe("CANCELLED");
    expect(cancelOrder).toHaveBeenCalledOnce();
  });

  it("reports operational capabilities", () => {
    const adapter = new BorzoAdapter();
    expect(adapter.metadata.supportedOperations).toEqual(
      expect.arrayContaining([
        "createBooking",
        "getBooking",
        "cancelBooking",
        "getTracking",
      ]),
    );
    expect(adapter.supportsOperation("createBooking")).toBe(true);
  });

  it("does not advertise OTP as a provider capability or operation", () => {
    const adapter = new BorzoAdapter();
    expect(adapter.metadata.supportedCapabilities).not.toContain("OTP");
    expect(adapter.metadata.supportedOperations).not.toEqual(
      expect.arrayContaining(["sendOtp", "verifyOtp"]),
    );
    expect(adapter.supportsOperation("parseWebhook")).toBe(true);
  });
});
