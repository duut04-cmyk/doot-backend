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
      SHIPROCKET_BOOKING_ENABLED: true,
      SHIPROCKET_PICKUP_LOCATION: "Doot Test Pickup",
      SHIPROCKET_AUTH_EMAIL: "sandbox@example.com",
      SHIPROCKET_AUTH_PASSWORD: "secret-password",
    },
  };
});

import type { BookingRequest } from "../src/modules/provider/contracts/booking.js";
import { ProviderHttpClient } from "../src/modules/provider/adapters/provider-http-client.js";
import { ShiprocketAuthService } from "../src/modules/provider/adapters/shiprocket/shiprocket-auth.service.js";
import { ShiprocketBookingService } from "../src/modules/provider/adapters/shiprocket/shiprocket-booking.service.js";
import { ShiprocketLifecycleService } from "../src/modules/provider/adapters/shiprocket/shiprocket-lifecycle.service.js";
import { resolveShiprocketCourierId } from "../src/modules/provider/adapters/shiprocket/shiprocket-metadata.util.js";
import type { ProviderRuntimeConfig } from "../src/modules/provider/adapters/provider-config.types.js";

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
  capabilities: ["BOOKING", "SERVICEABILITY", "PRICING"],
  services: [],
  credentials: {},
};

const bookingRequest: BookingRequest = {
  deliveryReference: "DOOT-REF-1",
  idempotencyKey: "corr-123",
  pickup: {
    addressText: "Pickup address",
    contactName: "Alice",
    contactPhoneCountryCode: "+91",
    contactPhoneNumber: "9876543210",
    latitude: 28.5,
    longitude: 77.0,
  },
  drop: {
    addressText: "Drop address",
    contactName: "Bob",
    contactPhoneCountryCode: "+91",
    contactPhoneNumber: "9811122233",
    latitude: 28.51,
    longitude: 77.01,
  },
  package: {
    packageType: "FOOD",
    weightKg: 1.2,
    quantity: 1,
  },
  schedule: {
    mode: "ASAP",
    timezone: "Asia/Kolkata",
  },
  requirements: [],
  providerQuoteId: "101",
  providerMetadata: {
    shiprocketHyperlocalRate: {
      courier_company_id: 101,
      rates: 89.5,
    },
    shiprocketPickupPostcode: "110030",
    shiprocketDeliveryPostcode: "122002",
  },
};

describe("Shiprocket booking lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves courier id from hyperlocal metadata", () => {
    expect(
      resolveShiprocketCourierId({
        providerMetadata: bookingRequest.providerMetadata,
        providerQuoteId: "101",
      }),
    ).toBe(101);
  });

  it("creates adhoc order and assigns AWB", async () => {
    const createFixture = JSON.parse(
      readFileSync(join(fixtureDir, "create-adhoc-success.json"), "utf8"),
    );
    const assignFixture = JSON.parse(
      readFileSync(join(fixtureDir, "assign-awb-success.json"), "utf8"),
    );

    const auth = {
      getBearerToken: vi.fn(async () => "token-redacted"),
    } as unknown as ShiprocketAuthService;

    const http = {
      request: vi.fn(async (_input: { request: { path: string; method: string } }) => {
        if (
          _input.request.method === "POST" &&
          _input.request.path.includes("create/adhoc")
        ) {
          return { status: 200, data: createFixture, headers: {}, durationMs: 1 };
        }
        if (
          _input.request.method === "POST" &&
          _input.request.path.includes("assign/awb")
        ) {
          return { status: 200, data: assignFixture, headers: {}, durationMs: 1 };
        }
        return { status: 404, data: {}, headers: {}, durationMs: 1 };
      }),
    } as unknown as ProviderHttpClient;

    const booking = new ShiprocketBookingService(http, auth);
    const result = await booking.createBooking(bookingRequest, {
      requestId: "req-book-1",
      config: runtimeConfig,
    });

    expect(result.outcome).toBe("BOOKED");
    expect(result.providerBookingId).toBe("16161616");
    expect(result.providerReference).toBe("15151515");
    expect(http.request).toHaveBeenCalledTimes(3);
  });

  it("uses a stable Shiprocket order_id derived from delivery reference", async () => {
    const createFixture = JSON.parse(
      readFileSync(join(fixtureDir, "create-adhoc-success.json"), "utf8"),
    );
    const auth = {
      getBearerToken: vi.fn(async () => "token-redacted"),
    } as unknown as ShiprocketAuthService;
    let capturedOrderId: string | undefined;
    const http = {
      request: vi.fn(
        async (_input: {
          request: { path: string; method: string; body?: unknown };
        }) => {
          if (
            _input.request.method === "GET" &&
            _input.request.path.includes("orders/show")
          ) {
            return { status: 404, data: {}, headers: {}, durationMs: 1 };
          }
          if (
            _input.request.method === "POST" &&
            _input.request.path.includes("create/adhoc")
          ) {
            capturedOrderId = (_input.request.body as { order_id?: string }).order_id;
            return { status: 200, data: createFixture, headers: {}, durationMs: 1 };
          }
          return { status: 422, data: {}, headers: {}, durationMs: 1 };
        },
      ),
    } as unknown as ProviderHttpClient;

    const booking = new ShiprocketBookingService(http, auth);
    await booking.createBooking(
      { ...bookingRequest, idempotencyKey: "attempt-2-should-not-win" },
      { requestId: "req-order-id", config: runtimeConfig },
    );

    expect(capturedOrderId).toBe(bookingRequest.deliveryReference);
  });

  it("returns UNKNOWN when AWB assignment fails after order creation", async () => {
    const createFixture = JSON.parse(
      readFileSync(join(fixtureDir, "create-adhoc-success.json"), "utf8"),
    );
    const auth = {
      getBearerToken: vi.fn(async () => "token-redacted"),
    } as unknown as ShiprocketAuthService;
    const http = {
      request: vi.fn(async (_input: { request: { path: string; method: string } }) => {
        if (
          _input.request.method === "GET" &&
          _input.request.path.includes("orders/show")
        ) {
          return { status: 404, data: {}, headers: {}, durationMs: 1 };
        }
        if (
          _input.request.method === "POST" &&
          _input.request.path.includes("create/adhoc")
        ) {
          return { status: 200, data: createFixture, headers: {}, durationMs: 1 };
        }
        return {
          status: 422,
          data: { message: "invalid" },
          headers: {},
          durationMs: 1,
        };
      }),
    } as unknown as ProviderHttpClient;

    const booking = new ShiprocketBookingService(http, auth);
    const result = await booking.createBooking(bookingRequest, {
      requestId: "req-book-2",
      config: runtimeConfig,
    });

    expect(result.outcome).toBe("UNKNOWN");
    expect(result.providerBookingId).toBe("16161616");
    expect(result.metadata?.shiprocketChannelOrderId).toBe(
      bookingRequest.deliveryReference,
    );
  });

  it("does not create adhoc when orders/show returns HTTP 498", async () => {
    const auth = {
      getBearerToken: vi.fn(async () => "token-redacted"),
    } as unknown as ShiprocketAuthService;
    const http = {
      request: vi.fn(async (_input: { request: { path: string; method: string } }) => {
        if (
          _input.request.method === "GET" &&
          _input.request.path.includes("orders/show")
        ) {
          return {
            status: 498,
            data: { message: "Access Denied" },
            headers: {},
            durationMs: 1,
          };
        }
        if (
          _input.request.method === "POST" &&
          _input.request.path.includes("create/adhoc")
        ) {
          throw new Error("create must not run after ambiguous orders/show outcome");
        }
        return { status: 404, data: {}, headers: {}, durationMs: 1 };
      }),
    } as unknown as ProviderHttpClient;

    const booking = new ShiprocketBookingService(http, auth);
    await expect(
      booking.createBooking(bookingRequest, {
        requestId: "req-show-498",
        config: runtimeConfig,
      }),
    ).rejects.toMatchObject({
      category: "PROVIDER_SERVICE_UNAVAILABLE",
    });

    const paths = http.request.mock.calls.map(
      (call) => (call[0] as { request: { method: string; path: string } }).request,
    );
    expect(
      paths.some((req) => req.method === "POST" && req.path.includes("create/adhoc")),
    ).toBe(false);
  });

  it("rejects booking when courier id cannot be resolved", async () => {
    const auth = {
      getBearerToken: vi.fn(async () => "token-redacted"),
    } as unknown as ShiprocketAuthService;
    const http = {
      request: vi.fn(),
    } as unknown as ProviderHttpClient;

    const booking = new ShiprocketBookingService(http, auth);
    await expect(
      booking.createBooking(
        {
          ...bookingRequest,
          providerQuoteId: "hl-rate-non-numeric",
          providerMetadata: {
            shiprocketHyperlocalRate: { courier_name: "Quick", rates: 50 },
          },
        },
        { requestId: "req-no-courier", config: runtimeConfig },
      ),
    ).rejects.toMatchObject({
      category: "PROVIDER_VALIDATION_ERROR",
    });
    expect(http.request).not.toHaveBeenCalled();
  });

  it("skips adhoc create when an order already exists for the channel order id", async () => {
    const showFixture = JSON.parse(
      readFileSync(join(fixtureDir, "order-show-success.json"), "utf8"),
    );
    const assignFixture = JSON.parse(
      readFileSync(join(fixtureDir, "assign-awb-success.json"), "utf8"),
    );
    const auth = {
      getBearerToken: vi.fn(async () => "token-redacted"),
    } as unknown as ShiprocketAuthService;
    const http = {
      request: vi.fn(async (_input: { request: { path: string; method: string } }) => {
        if (
          _input.request.method === "GET" &&
          _input.request.path.includes("orders/show")
        ) {
          return { status: 200, data: showFixture, headers: {}, durationMs: 1 };
        }
        if (
          _input.request.method === "POST" &&
          _input.request.path.includes("create/adhoc")
        ) {
          throw new Error("create should not run when order already exists");
        }
        if (
          _input.request.method === "POST" &&
          _input.request.path.includes("assign/awb")
        ) {
          return { status: 200, data: assignFixture, headers: {}, durationMs: 1 };
        }
        return { status: 404, data: {}, headers: {}, durationMs: 1 };
      }),
    } as unknown as ProviderHttpClient;

    const booking = new ShiprocketBookingService(http, auth);
    const result = await booking.createBooking(bookingRequest, {
      requestId: "req-existing-order",
      config: runtimeConfig,
    });

    expect(result.outcome).toBe("BOOKED");
    const paths = http.request.mock.calls.map(
      (call) => (call[0] as { request: { path: string } }).request.path,
    );
    expect(paths.some((path) => path.includes("create/adhoc"))).toBe(false);
  });

  it("returns UNKNOWN with order ids when AWB assignment times out after order exists", async () => {
    const createFixture = JSON.parse(
      readFileSync(join(fixtureDir, "create-adhoc-success.json"), "utf8"),
    );
    const auth = {
      getBearerToken: vi.fn(async () => "token-redacted"),
    } as unknown as ShiprocketAuthService;
    const { ProviderAdapterError } =
      await import("../src/modules/provider/contracts/provider-error.js");
    const http = {
      request: vi.fn(async (_input: { request: { path: string; method: string } }) => {
        if (
          _input.request.method === "GET" &&
          _input.request.path.includes("orders/show")
        ) {
          return { status: 404, data: {}, headers: {}, durationMs: 1 };
        }
        if (
          _input.request.method === "POST" &&
          _input.request.path.includes("create/adhoc")
        ) {
          return { status: 200, data: createFixture, headers: {}, durationMs: 1 };
        }
        if (
          _input.request.method === "POST" &&
          _input.request.path.includes("assign/awb")
        ) {
          throw new ProviderAdapterError({
            providerCode: "SHIPROCKET",
            category: "PROVIDER_TIMEOUT",
            operation: "createBooking",
            safeMessage: "Timed out.",
          });
        }
        return { status: 404, data: {}, headers: {}, durationMs: 1 };
      }),
    } as unknown as ProviderHttpClient;

    const booking = new ShiprocketBookingService(http, auth);
    const result = await booking.createBooking(bookingRequest, {
      requestId: "req-assign-timeout",
      config: runtimeConfig,
    });

    expect(result.outcome).toBe("UNKNOWN");
    expect(result.providerBookingId).toBe("16161616");
    expect(result.metadata?.shiprocketChannelOrderId).toBe(
      bookingRequest.deliveryReference,
    );
  });

  it("cancels a numeric Shiprocket order id", async () => {
    const auth = {
      getBearerToken: vi.fn(async () => "token-redacted"),
    } as unknown as ShiprocketAuthService;
    const http = {
      request: vi.fn(async () => ({
        status: 204,
        data: {},
        headers: {},
        durationMs: 1,
      })),
    } as unknown as ProviderHttpClient;

    const lifecycle = new ShiprocketLifecycleService(http, auth);
    const result = await lifecycle.cancelBooking(
      { providerBookingId: "16161616", reason: "customer_request" },
      { requestId: "req-cancel-1", config: runtimeConfig },
    );

    expect(result.outcome).toBe("CANCELLED");
  });

  it("loads tracking via shipment id when AWB is unavailable", async () => {
    const orderFixture = {
      data: {
        id: 16161616,
        status: "NEW",
        awb_code: null,
        shipments: [{ id: 15151515 }],
      },
    };
    const trackFixture = JSON.parse(
      readFileSync(join(fixtureDir, "track-shipment-success.json"), "utf8"),
    );

    const auth = {
      getBearerToken: vi.fn(async () => "token-redacted"),
    } as unknown as ShiprocketAuthService;

    const http = {
      request: vi.fn(async (_input: { request: { path: string } }) => {
        const path = _input.request.path;
        if (path.includes("/orders/show/")) {
          return { status: 200, data: orderFixture, headers: {}, durationMs: 1 };
        }
        if (path.includes("/courier/track/")) {
          return { status: 200, data: trackFixture, headers: {}, durationMs: 1 };
        }
        return { status: 404, data: {}, headers: {}, durationMs: 1 };
      }),
    } as unknown as ProviderHttpClient;

    const lifecycle = new ShiprocketLifecycleService(http, auth);
    const result = await lifecycle.getTracking("16161616", {
      requestId: "req-track-1",
      config: runtimeConfig,
    });

    expect(result.status).toBe("IN TRANSIT");
  });
});
