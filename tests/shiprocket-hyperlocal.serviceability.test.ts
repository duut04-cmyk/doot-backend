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
import { parseShiprocketHyperlocalServiceability } from "../src/modules/provider/adapters/shiprocket/shiprocket-hyperlocal.parser.js";
import { ShiprocketHyperlocalServiceabilityService } from "../src/modules/provider/adapters/shiprocket/shiprocket-hyperlocal.serviceability.js";
import { ShiprocketAuthService } from "../src/modules/provider/adapters/shiprocket/shiprocket-auth.service.js";
import type { ProviderRuntimeConfig } from "../src/modules/provider/adapters/provider-config.types.js";
import type { ServiceabilityRequest } from "../src/modules/provider/contracts/serviceability.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/shiprocket");

const runtimeConfig: ProviderRuntimeConfig = {
  providerId: "provider-id",
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

const baseRequest: ServiceabilityRequest = {
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

describe("Shiprocket hyperlocal serviceability", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("parses multi-rate success fixture into candidates", () => {
    const fixture = JSON.parse(
      readFileSync(join(fixtureDir, "hyperlocal-serviceability-success.json"), "utf8"),
    );
    const parsed = parseShiprocketHyperlocalServiceability(fixture);
    expect(parsed.candidates).toHaveLength(2);
    expect(parsed.candidates[0]?.amountInr).toBe(89.5);
    expect(parsed.candidates[1]?.amountInr).toBe(72);
  });

  it("treats empty data as serviceable=false without error", () => {
    const fixture = JSON.parse(
      readFileSync(join(fixtureDir, "hyperlocal-serviceability-empty.json"), "utf8"),
    );
    const parsed = parseShiprocketHyperlocalServiceability(fixture);
    expect(parsed.success).toBe(true);
    expect(parsed.candidates).toHaveLength(0);
  });

  it("fetchRates geocodes, authenticates, and returns quote candidates", async () => {
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
        expect(url).toContain("is_new_hyperlocal=1");
        expect(url).toContain("cod=0");
        expect(url).toContain("weight=1.2");
        const headers = init?.headers as Record<string, string> | undefined;
        const accept =
          headers?.Accept ??
          headers?.accept ??
          (headers && "get" in headers
            ? (headers as Headers).get("accept")
            : undefined);
        expect(accept).toBe("application/json");
        return new Response(JSON.stringify(serviceabilityFixture), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });

    const { ProviderHttpClient } =
      await import("../src/modules/provider/adapters/provider-http-client.js");
    const http = new ProviderHttpClient(httpFetch as typeof fetch);
    const auth = new ShiprocketAuthService(http);
    auth.clearCacheForTests();

    const service = new ShiprocketHyperlocalServiceabilityService(
      http,
      auth,
      geocoding,
    );
    const result = await service.fetchRates(baseRequest, {
      requestId: "req-hl-1",
      config: runtimeConfig,
    });

    expect(result.candidates).toHaveLength(2);
    expect(result.serviceability.serviceable).toBe(true);
    expect(result.pickupPostcode).toBe("110001");
  });
});
