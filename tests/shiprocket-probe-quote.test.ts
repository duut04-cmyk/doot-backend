import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config/env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config/env.js")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      SHIPROCKET_ENABLED: true,
      SHIPROCKET_AUTH_EMAIL: "sandbox@example.com",
      SHIPROCKET_AUTH_PASSWORD: "secret-password",
      GOOGLE_GEOCODING_API_KEY: "geocode-key",
    },
  };
});

import { GoogleGeocodingClient } from "../src/infrastructure/geocoding/google-geocoding.client.js";
import { ShiprocketProviderAdapter } from "../src/modules/provider/adapters/shiprocket/shiprocket-provider.adapter.js";
import { ShiprocketHyperlocalServiceabilityService } from "../src/modules/provider/adapters/shiprocket/shiprocket-hyperlocal.serviceability.js";
import { ShiprocketAuthService } from "../src/modules/provider/adapters/shiprocket/shiprocket-auth.service.js";
import { InMemoryShiprocketAuthRefreshLock } from "../src/modules/provider/adapters/shiprocket/shiprocket-auth-refresh.lock.js";
import { isQuoteProbeAdapter } from "../src/modules/provider/adapters/provider-adapter.types.js";
import { InMemoryProviderAuthTokenRepository } from "./helpers/in-memory-provider-auth-token.repository.js";
import type { ProviderRuntimeConfig } from "../src/modules/provider/adapters/provider-config.types.js";
import type { QuoteRequest } from "../src/modules/provider/contracts/quote.js";
import { ProviderIntegrationService } from "../src/modules/provider/provider.integration.service.js";
import { ProviderAdapterResolver } from "../src/modules/provider/adapters/provider-adapter-resolver.js";
import { ProviderAdapterRegistry } from "../src/modules/provider/adapters/provider-adapter-registry.js";
import { ProviderConfigResolver } from "../src/modules/provider/adapters/provider-config-resolver.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/shiprocket");

const runtimeConfig: ProviderRuntimeConfig = {
  providerId: "provider-probe-quote",
  providerCode: "SHIPROCKET",
  environment: "SANDBOX",
  status: "ACTIVE",
  enabled: true,
  integrationStatus: "READY",
  baseUrl: "https://api-sandbox.shiprocket.in",
  timeoutMs: 5000,
  connectTimeoutMs: 5000,
  maxRetries: 0,
  retryDelayMs: 0,
  capabilities: ["SERVICEABILITY", "PRICING"],
  services: [],
  credentials: {},
};

const quoteRequest: QuoteRequest = {
  pickup: {
    addressText: "Pickup",
    contactName: "A",
    contactPhoneCountryCode: "+91",
    contactPhoneNumber: "9876543210",
    instructions: null,
    latitude: 28.6315,
    longitude: 77.2167,
  },
  drop: {
    addressText: "Drop",
    contactName: "B",
    contactPhoneCountryCode: "+91",
    contactPhoneNumber: "9811122233",
    instructions: null,
    latitude: 28.7041,
    longitude: 77.1025,
  },
  package: {
    packageType: "FOOD",
    weightKg: 1.2,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    quantity: 1,
    description: null,
  },
  schedule: {
    mode: "ASAP",
    timezone: "Asia/Kolkata",
    scheduledAt: null,
    windowStart: null,
    windowEnd: null,
  },
  requirements: [],
  specialInstructions: null,
};

async function buildAdapterWithMocks(): Promise<{
  adapter: ShiprocketProviderAdapter;
  httpFetch: ReturnType<typeof vi.fn>;
}> {
  const loginFixture = JSON.parse(
    readFileSync(join(fixtureDir, "auth-login-success.json"), "utf8"),
  );
  const serviceabilityFixture = JSON.parse(
    readFileSync(join(fixtureDir, "hyperlocal-serviceability-success.json"), "utf8"),
  );

  const geocodeFetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          status: "OK",
          results: [
            {
              address_components: [
                { long_name: "110001", short_name: "110001", types: ["postal_code"] },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
  );
  const geocoding = new GoogleGeocodingClient(geocodeFetch as typeof fetch);

  const httpFetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "POST" && url.includes("/auth/login")) {
      return new Response(JSON.stringify(loginFixture), { status: 200 });
    }
    if (method === "GET" && url.includes("/courier/serviceability")) {
      return new Response(JSON.stringify(serviceabilityFixture), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  });

  const { ProviderHttpClient } =
    await import("../src/modules/provider/adapters/provider-http-client.js");
  const http = new ProviderHttpClient(httpFetch as typeof fetch);
  const auth = new ShiprocketAuthService(
    http,
    new InMemoryProviderAuthTokenRepository(),
    new InMemoryShiprocketAuthRefreshLock(),
  );
  auth.clearCacheForTests();

  const hyperlocal = new ShiprocketHyperlocalServiceabilityService(
    http,
    auth,
    geocoding,
  );
  return {
    adapter: new ShiprocketProviderAdapter(hyperlocal, auth),
    httpFetch,
  };
}

describe("Shiprocket probeQuote (read-only hyperlocal diagnostic)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("exposes probeQuote for admin quote diagnostics", async () => {
    const { adapter } = await buildAdapterWithMocks();
    expect(isQuoteProbeAdapter(adapter)).toBe(true);
  });

  it("returns normalized quote, serviceability, and availability without mutating endpoints", async () => {
    const { adapter, httpFetch } = await buildAdapterWithMocks();
    const probe = await adapter.probeQuote(quoteRequest, {
      requestId: "probe-req-1",
      config: runtimeConfig,
    });

    expect(probe.serviceability.serviceable).toBe(true);
    expect(probe.quote.available).toBe(true);
    expect(probe.quote.amount?.amount).toBe(89.5);
    expect(probe.candidates).toHaveLength(2);
    expect(probe.selectedCandidateIndex).toBe(0);
    expect(probe.availability.known).toBe(false);
    for (const call of httpFetch.mock.calls) {
      const url = String(call[0]);
      const method = (call[1]?.method ?? "GET").toUpperCase();
      if (method === "POST") {
        expect(url).toContain("/auth/login");
        continue;
      }
      expect(method).toBe("GET");
      expect(url).toContain("/courier/serviceability");
      expect(url).not.toMatch(/orders\/create|assign\/awb|orders\/cancel/i);
    }
  });

  it("ProviderIntegrationService.testQuote succeeds for Shiprocket adapter", async () => {
    const { adapter } = await buildAdapterWithMocks();
    const repo = new InMemoryProviderRepository();
    const provider = await repo.createProvider({
      code: "SHIPROCKET",
      name: "Shiprocket",
      displayName: "Shiprocket",
      description: null,
      environment: "SANDBOX",
      enabled: true,
      orchestrationEnabled: true,
      priority: 10,
      integrationStatus: "READY",
      settings: {
        timeoutMs: 5000,
        connectTimeoutMs: 5000,
        maxRetries: 0,
        retryDelayMs: 0,
        webhookEnabled: false,
        healthCheckEnabled: true,
        healthCheckIntervalMs: 300000,
      },
      capabilities: ["SERVICEABILITY", "PRICING"],
    });

    const registry = new ProviderAdapterRegistry();
    registry.register(adapter);
    const resolver = new ProviderAdapterResolver(
      registry,
      new ProviderConfigResolver(repo),
    );
    const service = new ProviderIntegrationService(resolver);

    const result = await service.testQuote({
      providerId: provider.id,
      body: quoteRequest,
      requestId: "admin-test-quote-req",
    });

    expect(result.success).toBe(true);
    expect(result.data.providerCode).toBe("SHIPROCKET");
    expect(result.data.quote.available).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret-password");
  });
});
