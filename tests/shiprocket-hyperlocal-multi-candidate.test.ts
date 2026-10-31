import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

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
import { InMemoryProviderAuthTokenRepository } from "./helpers/in-memory-provider-auth-token.repository.js";
import type { ProviderRuntimeConfig } from "../src/modules/provider/adapters/provider-config.types.js";
import type { ServiceabilityRequest } from "../src/modules/provider/contracts/serviceability.js";
import { OrchestrationProviderEvaluationService } from "../src/modules/orchestration/orchestration.provider-evaluation.js";
import type { DeliveryDetailDto } from "../src/modules/delivery/delivery.types.js";
import type { ProviderWithRelations } from "../src/modules/provider/provider.repository.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/shiprocket");

const runtimeConfig: ProviderRuntimeConfig = {
  providerId: "provider-shiprocket-multi",
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

const serviceabilityRequest: ServiceabilityRequest = {
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
    packageType: "PARCEL",
    weightKg: 0.5,
    lengthCm: 10,
    widthCm: 10,
    heightCm: 10,
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

function deliveryDetail(): DeliveryDetailDto {
  return {
    id: randomUUID(),
    reference: "DOOT-MULTI",
    customerId: randomUUID(),
    status: "CREATED",
    pickup: {
      addressText: "Pickup",
      contactName: "A",
      contactPhone: { countryCode: "+91", number: "9876543210" },
      instructions: null,
      latitude: 28.6315,
      longitude: 77.2167,
    },
    drop: {
      addressText: "Drop",
      contactName: "B",
      contactPhone: { countryCode: "+91", number: "9811122233" },
      instructions: null,
      latitude: 28.7041,
      longitude: 77.1025,
    },
    package: {
      packageType: "PARCEL",
      description: null,
      weightKg: 0.5,
      lengthCm: 10,
      widthCm: 10,
      heightCm: 10,
      sizeTier: "SMALL",
      quantity: 1,
      photos: [],
    },
    requirements: [],
    specialInstructions: null,
    schedule: { mode: "ASAP", timezone: "Asia/Kolkata" },
    compliance: { accepted: true, acceptedAt: new Date().toISOString() },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function shiprocketProvider(): ProviderWithRelations {
  return {
    id: runtimeConfig.providerId,
    code: "SHIPROCKET",
    name: "Shiprocket",
    status: "ACTIVE",
    enabled: true,
    orchestrationEnabled: true,
    integrationStatus: "READY",
    healthStatus: "HEALTHY",
    priority: 1,
    capabilities: [{ capability: "PRICING" }, { capability: "SERVICEABILITY" }],
    services: [],
    vehicles: [],
    limits: [],
    credentials: [],
    settings: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as ProviderWithRelations;
}

async function buildAdapterWithThreeCouriers(): Promise<ShiprocketProviderAdapter> {
  const loginFixture = JSON.parse(
    readFileSync(join(fixtureDir, "auth-login-success.json"), "utf8"),
  );
  const threeFixture = JSON.parse(
    readFileSync(
      join(fixtureDir, "hyperlocal-serviceability-three-couriers.json"),
      "utf8",
    ),
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
      return new Response(JSON.stringify(threeFixture), { status: 200 });
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
  return new ShiprocketProviderAdapter(hyperlocal, auth);
}

describe("Shiprocket hyperlocal multi-candidate preservation", () => {
  it("fetchHyperlocalRates preserves three candidates with distinct quotes", async () => {
    const adapter = await buildAdapterWithThreeCouriers();
    const result = await adapter.fetchHyperlocalRates(serviceabilityRequest, {
      requestId: "multi-candidate-req",
      config: runtimeConfig,
    });

    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.map((c) => c.quote.amount?.amount)).toEqual([
      120, 95.5, 110,
    ]);
    expect(result.candidates.map((c) => c.quote.providerQuoteId)).toEqual([
      "hl-rate-201",
      "hl-rate-202",
      "hl-rate-203",
    ]);
    expect(
      result.candidates.map((c) => c.providerMetadata.shiprocketCourierName),
    ).toEqual(["Courier Alpha", "Courier Beta", "Courier Gamma"]);
  });

  it("probeQuote exposes all candidates and selects the first explicitly", async () => {
    const adapter = await buildAdapterWithThreeCouriers();
    const probe = await adapter.probeQuote(serviceabilityRequest, {
      requestId: "probe-multi",
      config: runtimeConfig,
    });

    expect(probe.candidates).toHaveLength(3);
    expect(probe.selectedCandidateIndex).toBe(0);
    expect(probe.quote.providerQuoteId).toBe("hl-rate-201");
    expect(probe.quote.amount?.amount).toBe(120);
  });

  it("orchestration evaluateProvider returns one outcome per courier candidate", async () => {
    const adapter = await buildAdapterWithThreeCouriers();
    const service = new OrchestrationProviderEvaluationService(
      {} as never,
      {
        resolveForExecution: vi.fn(async () => ({
          adapter,
          config: runtimeConfig,
        })),
      } as never,
    );

    const outcomes = await service.evaluateProvider({
      provider: shiprocketProvider(),
      delivery: deliveryDetail(),
      requestId: "orch-multi",
    });

    expect(Array.isArray(outcomes)).toBe(true);
    const list = outcomes as Awaited<
      ReturnType<OrchestrationProviderEvaluationService["evaluateProvider"]>
    >;
    const eligible = (Array.isArray(list) ? list : [list]).filter(
      (o) => o.status === "ELIGIBLE",
    );
    expect(eligible).toHaveLength(3);
    expect(eligible.map((o) => o.signals.quote?.providerQuoteId)).toEqual([
      "hl-rate-201",
      "hl-rate-202",
      "hl-rate-203",
    ]);
    expect(eligible.map((o) => o.signals.quote?.amount?.amount)).toEqual([
      120, 95.5, 110,
    ]);
  });
});
