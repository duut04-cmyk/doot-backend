import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderHttpClient } from "../src/modules/provider/adapters/provider-http-client.js";
import { ShiprocketAuthService } from "../src/modules/provider/adapters/shiprocket/shiprocket-auth.service.js";
import { ShiprocketLifecycleService } from "../src/modules/provider/adapters/shiprocket/shiprocket-lifecycle.service.js";
import { ProviderAdapterError } from "../src/modules/provider/contracts/provider-error.js";
import type { ProviderRuntimeConfig } from "../src/modules/provider/adapters/provider-config.types.js";

vi.mock("../src/config/env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config/env.js")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      SHIPROCKET_BOOKING_ENABLED: false,
    },
  };
});

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
  capabilities: ["BOOKING", "LIVE_TRACKING"],
  services: [],
  credentials: {},
};

describe("ShiprocketLifecycleService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses orders/show path with encoded order id", async () => {
    const auth = {
      getBearerToken: vi.fn(async () => "token-redacted"),
    } as unknown as ShiprocketAuthService;
    const http = {
      request: vi.fn(async () => ({
        status: 200,
        data: JSON.parse(
          readFileSync(join(fixtureDir, "order-show-success.json"), "utf8"),
        ),
        headers: {},
        durationMs: 1,
      })),
    } as unknown as ProviderHttpClient;

    const lifecycle = new ShiprocketLifecycleService(http, auth);
    await lifecycle.getBooking("16161616", {
      requestId: "req-1",
      config: runtimeConfig,
    });

    expect(http.request).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          path: "/v1/external/orders/show/16161616",
        }),
      }),
    );
  });

  it("returns BOOKED only when AWB is present and valid", async () => {
    const auth = {
      getBearerToken: vi.fn(async () => "token-redacted"),
    } as unknown as ShiprocketAuthService;
    const http = {
      request: vi.fn(async () => ({
        status: 200,
        data: JSON.parse(
          readFileSync(join(fixtureDir, "order-show-success.json"), "utf8"),
        ),
        headers: {},
        durationMs: 1,
      })),
    } as unknown as ProviderHttpClient;

    const lifecycle = new ShiprocketLifecycleService(http, auth);
    const booked = await lifecycle.getBooking("16161616", {
      requestId: "req-booked",
      config: runtimeConfig,
    });
    expect(booked.outcome).toBe("BOOKED");
    expect(booked.metadata?.shiprocketAwbCode).toBe("SR123456789IN");
  });

  it("returns UNKNOWN when shipment exists but AWB is missing", async () => {
    const auth = {
      getBearerToken: vi.fn(async () => "token-redacted"),
    } as unknown as ShiprocketAuthService;
    const http = {
      request: vi.fn(async () => ({
        status: 200,
        data: {
          data: {
            id: 16161616,
            status: "NEW",
            awb_code: null,
            shipments: [{ id: 15151515 }],
          },
        },
        headers: {},
        durationMs: 1,
      })),
    } as unknown as ProviderHttpClient;

    const lifecycle = new ShiprocketLifecycleService(http, auth);
    const result = await lifecycle.getBooking("16161616", {
      requestId: "req-no-awb",
      config: runtimeConfig,
    });
    expect(result.outcome).toBe("UNKNOWN");
    expect(result.metadata?.shiprocketAwbCode).toBeNull();
    expect(result.metadata?.shiprocketShipmentId).toBe("15151515");
  });

  it("prefers AWB tracking path when AWB is valid", async () => {
    const trackFixture = JSON.parse(
      readFileSync(join(fixtureDir, "track-awb-success.json"), "utf8"),
    );
    const auth = {
      getBearerToken: vi.fn(async () => "token-redacted"),
    } as unknown as ShiprocketAuthService;
    const http = {
      request: vi.fn(async (input: { request: { path: string } }) => {
        expect(input.request.path).toContain("/courier/track/awb/SR123456789IN");
        return { status: 200, data: trackFixture, headers: {}, durationMs: 1 };
      }),
    } as unknown as ProviderHttpClient;

    const lifecycle = new ShiprocketLifecycleService(http, auth);
    const result = await lifecycle.getTracking(
      "16161616",
      { requestId: "req-awb-track", config: runtimeConfig },
      { awbCode: "SR123456789IN", shipmentId: "15151515" },
    );

    expect(result.trackingUrl).toBe("https://shiprocket.example/track/SR123456789IN");
    expect(result.metadata?.trackingAvailability).toBe("AVAILABLE");
  });

  it("tracks by persisted shipment id without calling orders/show", async () => {
    const trackFixture = JSON.parse(
      readFileSync(join(fixtureDir, "track-shipment-success.json"), "utf8"),
    );
    const auth = {
      getBearerToken: vi.fn(async () => "token-redacted"),
    } as unknown as ShiprocketAuthService;
    const http = {
      request: vi.fn(async (input: { request: { path: string } }) => {
        expect(input.request.path).not.toContain("/orders/show/");
        expect(input.request.path).toContain("/courier/track/shipment/15151515");
        return { status: 200, data: trackFixture, headers: {}, durationMs: 1 };
      }),
    } as unknown as ProviderHttpClient;

    const lifecycle = new ShiprocketLifecycleService(http, auth);
    await lifecycle.getTracking(
      "DOOT-CHANNEL-ONLY",
      { requestId: "req-ship-only", config: runtimeConfig },
      { shipmentId: "15151515", awbCode: null },
    );
  });

  it("uses shipment tracking when AWB is invalid", async () => {
    const trackFixture = JSON.parse(
      readFileSync(join(fixtureDir, "track-shipment-success.json"), "utf8"),
    );
    const auth = {
      getBearerToken: vi.fn(async () => "token-redacted"),
    } as unknown as ShiprocketAuthService;
    const paths: string[] = [];
    const http = {
      request: vi.fn(async (input: { request: { path: string } }) => {
        paths.push(input.request.path);
        return { status: 200, data: trackFixture, headers: {}, durationMs: 1 };
      }),
    } as unknown as ProviderHttpClient;

    const lifecycle = new ShiprocketLifecycleService(http, auth);
    await lifecycle.getTracking(
      "16161616",
      { requestId: "req-shipment-track", config: runtimeConfig },
      { awbCode: "NA", shipmentId: "15151515" },
    );

    expect(
      paths.some((path) => path.includes("/courier/track/shipment/15151515")),
    ).toBe(true);
    expect(paths.some((path) => path.includes("/courier/track/awb/"))).toBe(false);
  });

  it("returns PENDING tracking without treating as hard failure", async () => {
    const pendingFixture = JSON.parse(
      readFileSync(join(fixtureDir, "track-pending.json"), "utf8"),
    );
    const auth = {
      getBearerToken: vi.fn(async () => "token-redacted"),
    } as unknown as ShiprocketAuthService;
    const http = {
      request: vi.fn(async () => ({
        status: 200,
        data: pendingFixture,
        headers: {},
        durationMs: 1,
      })),
    } as unknown as ProviderHttpClient;

    const lifecycle = new ShiprocketLifecycleService(http, auth);
    const result = await lifecycle.getTracking(
      "16161616",
      { requestId: "req-pending", config: runtimeConfig },
      { shipmentId: "15151515" },
    );

    expect(result.metadata?.trackingAvailability).toBe("PENDING");
    expect(result.status).toBe("TRACKING_PENDING");
  });

  it("maps HTTP 401 on tracking to authentication error", async () => {
    const auth = {
      getBearerToken: vi.fn(async () => "token-redacted"),
    } as unknown as ShiprocketAuthService;
    const http = {
      request: vi.fn(async () => ({
        status: 401,
        data: {},
        headers: {},
        durationMs: 1,
      })),
    } as unknown as ProviderHttpClient;

    const lifecycle = new ShiprocketLifecycleService(http, auth);
    await expect(
      lifecycle.getTracking(
        "16161616",
        { requestId: "req-401", config: runtimeConfig },
        { shipmentId: "15151515" },
      ),
    ).rejects.toMatchObject({
      category: "PROVIDER_AUTHENTICATION_ERROR",
    });
  });

  it("throws when tracking body is uninterpretable", async () => {
    const auth = {
      getBearerToken: vi.fn(async () => "token-redacted"),
    } as unknown as ShiprocketAuthService;
    const http = {
      request: vi.fn(async () => ({
        status: 200,
        data: { unexpected: true },
        headers: {},
        durationMs: 1,
      })),
    } as unknown as ProviderHttpClient;

    const lifecycle = new ShiprocketLifecycleService(http, auth);
    await expect(
      lifecycle.getTracking(
        "16161616",
        { requestId: "req-bad", config: runtimeConfig },
        { shipmentId: "15151515" },
      ),
    ).rejects.toBeInstanceOf(ProviderAdapterError);
  });
});
