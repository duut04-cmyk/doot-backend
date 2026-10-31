import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderHttpClient } from "../src/modules/provider/adapters/provider-http-client.js";
import { ShiprocketAuthService } from "../src/modules/provider/adapters/shiprocket/shiprocket-auth.service.js";
import { ShiprocketLifecycleService } from "../src/modules/provider/adapters/shiprocket/shiprocket-lifecycle.service.js";
import type { ProviderRuntimeConfig } from "../src/modules/provider/adapters/provider-config.types.js";

vi.mock("../src/config/env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config/env.js")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      SHIPROCKET_BOOKING_ENABLED: true,
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
  capabilities: ["BOOKING", "CANCELLATION"],
  services: [],
  credentials: {},
};

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8"));
}

describe("ShiprocketLifecycleService.cancelBooking", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const auth = {
    getBearerToken: vi.fn(async () => "token-redacted"),
  } as unknown as ShiprocketAuthService;

  it("POSTs numeric order id to orders/cancel", async () => {
    const orderShowNew = loadFixture("order-show-still-new.json");
    const orderShowCancelled = loadFixture("order-show-cancelled.json");
    let cancelPosted = false;

    const http = {
      request: vi.fn(async (input: { request: { method: string; path: string } }) => {
        if (input.request.path.includes("/orders/show/")) {
          return {
            status: 200,
            data: cancelPosted ? orderShowCancelled : orderShowNew,
            headers: {},
            durationMs: 1,
          };
        }
        if (
          input.request.method === "POST" &&
          input.request.path === "/v1/external/orders/cancel"
        ) {
          cancelPosted = true;
          return { status: 204, data: {}, headers: {}, durationMs: 1 };
        }
        return { status: 404, data: {}, headers: {}, durationMs: 1 };
      }),
    } as unknown as ProviderHttpClient;

    const lifecycle = new ShiprocketLifecycleService(http, auth);
    const result = await lifecycle.cancelBooking(
      { providerBookingId: "16161616", reason: "customer_request" },
      { requestId: "req-cancel-1", config: runtimeConfig },
    );

    expect(result.outcome).toBe("CANCELLED");
    const postCall = (http.request as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0].request.path === "/v1/external/orders/cancel",
    );
    expect(postCall?.[0].request.body).toEqual({ ids: [16161616] });
    expect(postCall?.[0].request.headers.authorization).toBe("Bearer token-redacted");
  });

  it("accepts 204 with empty body and reconciles via order-show", async () => {
    const http = {
      request: vi.fn(async (input: { request: { path: string } }) => {
        if (input.request.path.includes("/orders/show/")) {
          return {
            status: 200,
            data: loadFixture("order-show-cancelled.json"),
            headers: {},
            durationMs: 1,
          };
        }
        return { status: 204, data: {}, headers: {}, durationMs: 1 };
      }),
    } as unknown as ProviderHttpClient;

    const lifecycle = new ShiprocketLifecycleService(http, auth);
    const result = await lifecycle.cancelBooking(
      { providerBookingId: "16161616", reason: null },
      { requestId: "req-204", config: runtimeConfig },
    );
    expect(result.outcome).toBe("CANCELLED");
  });

  it("accepts other 2xx responses", async () => {
    const http = {
      request: vi.fn(async (input: { request: { path: string } }) => {
        if (input.request.path.includes("/orders/show/")) {
          return {
            status: 200,
            data: loadFixture("order-show-cancelled.json"),
            headers: {},
            durationMs: 1,
          };
        }
        return { status: 200, data: { ok: true }, headers: {}, durationMs: 1 };
      }),
    } as unknown as ProviderHttpClient;

    const lifecycle = new ShiprocketLifecycleService(http, auth);
    const result = await lifecycle.cancelBooking(
      { providerBookingId: "16161616", reason: null },
      { requestId: "req-200", config: runtimeConfig },
    );
    expect(result.outcome).toBe("CANCELLED");
  });

  it("returns REJECTED on 422 with parsed message", async () => {
    const http = {
      request: vi.fn(async (input: { request: { path: string } }) => {
        if (input.request.path.includes("/orders/show/")) {
          return {
            status: 200,
            data: loadFixture("order-show-still-new.json"),
            headers: {},
            durationMs: 1,
          };
        }
        return {
          status: 422,
          data: { message: "Cannot cancel picked order" },
          headers: {},
          durationMs: 1,
        };
      }),
    } as unknown as ProviderHttpClient;

    const lifecycle = new ShiprocketLifecycleService(http, auth);
    const result = await lifecycle.cancelBooking(
      { providerBookingId: "16161616", reason: null },
      { requestId: "req-422", config: runtimeConfig },
    );
    expect(result.outcome).toBe("REJECTED");
    expect(result.reason).toBe("Cannot cancel picked order");
  });

  it.each([
    [401, "PROVIDER_AUTHENTICATION_ERROR"],
    [403, "PROVIDER_AUTHORIZATION_ERROR"],
    [429, "PROVIDER_RATE_LIMITED"],
    [500, "PROVIDER_SERVICE_UNAVAILABLE"],
  ] as const)("maps HTTP %s to %s", async (status, category) => {
    const http = {
      request: vi.fn(async (input: { request: { path: string } }) => {
        if (input.request.path.includes("/orders/show/")) {
          return {
            status: 200,
            data: loadFixture("order-show-still-new.json"),
            headers: {},
            durationMs: 1,
          };
        }
        return { status, data: "not-json", headers: {}, durationMs: 1 };
      }),
    } as unknown as ProviderHttpClient;

    const lifecycle = new ShiprocketLifecycleService(http, auth);
    await expect(
      lifecycle.cancelBooking(
        { providerBookingId: "16161616", reason: null },
        { requestId: `req-${status}`, config: runtimeConfig },
      ),
    ).rejects.toMatchObject({
      category,
    });
  });

  it("returns UNKNOWN when post-cancel reconcile is inconclusive", async () => {
    const http = {
      request: vi.fn(async (input: { request: { path: string } }) => {
        if (input.request.path.includes("/orders/show/")) {
          return {
            status: 200,
            data: {
              data: {
                id: 16161616,
                status: "CUSTOM_UNKNOWN_STATE",
              },
            },
            headers: {},
            durationMs: 1,
          };
        }
        return { status: 204, data: {}, headers: {}, durationMs: 1 };
      }),
    } as unknown as ProviderHttpClient;

    const lifecycle = new ShiprocketLifecycleService(http, auth);
    const result = await lifecycle.cancelBooking(
      { providerBookingId: "16161616", reason: null },
      { requestId: "req-unknown", config: runtimeConfig },
    );
    expect(result.outcome).toBe("UNKNOWN");
  });

  it("returns REJECTED when order-show still NEW after cancel POST", async () => {
    const http = {
      request: vi.fn(async (input: { request: { path: string } }) => {
        if (input.request.path.includes("/orders/show/")) {
          return {
            status: 200,
            data: loadFixture("order-show-still-new.json"),
            headers: {},
            durationMs: 1,
          };
        }
        return { status: 204, data: {}, headers: {}, durationMs: 1 };
      }),
    } as unknown as ProviderHttpClient;

    const lifecycle = new ShiprocketLifecycleService(http, auth);
    const result = await lifecycle.cancelBooking(
      { providerBookingId: "16161616", reason: null },
      { requestId: "req-still-new", config: runtimeConfig },
    );
    expect(result.outcome).toBe("REJECTED");
  });

  it("returns UNKNOWN when post-cancel order-show fails", async () => {
    let cancelPosted = false;
    const http = {
      request: vi.fn(async (input: { request: { path: string; method: string } }) => {
        if (input.request.path.includes("/orders/show/")) {
          if (cancelPosted) {
            return { status: 503, data: {}, headers: {}, durationMs: 1 };
          }
          return {
            status: 200,
            data: loadFixture("order-show-still-new.json"),
            headers: {},
            durationMs: 1,
          };
        }
        if (
          input.request.method === "POST" &&
          input.request.path === "/v1/external/orders/cancel"
        ) {
          cancelPosted = true;
        }
        return { status: 204, data: {}, headers: {}, durationMs: 1 };
      }),
    } as unknown as ProviderHttpClient;

    const lifecycle = new ShiprocketLifecycleService(http, auth);
    const result = await lifecycle.cancelBooking(
      { providerBookingId: "16161616", reason: null },
      { requestId: "req-post-fail", config: runtimeConfig },
    );
    expect(result.outcome).toBe("UNKNOWN");
  });

  it("rejects non-numeric provider booking id", async () => {
    const http = { request: vi.fn() } as unknown as ProviderHttpClient;
    const lifecycle = new ShiprocketLifecycleService(http, auth);
    await expect(
      lifecycle.cancelBooking(
        { providerBookingId: "channel-id", reason: null },
        { requestId: "req-bad-id", config: runtimeConfig },
      ),
    ).rejects.toMatchObject({ category: "PROVIDER_VALIDATION_ERROR" });
    expect(http.request).not.toHaveBeenCalled();
  });

  it("skips cancel POST when order is already cancelled at provider", async () => {
    const http = {
      request: vi.fn(async (input: { request: { path: string; method: string } }) => {
        if (input.request.path.includes("/orders/show/")) {
          return {
            status: 200,
            data: loadFixture("order-show-cancelled.json"),
            headers: {},
            durationMs: 1,
          };
        }
        return { status: 204, data: {}, headers: {}, durationMs: 1 };
      }),
    } as unknown as ProviderHttpClient;

    const lifecycle = new ShiprocketLifecycleService(http, auth);
    const result = await lifecycle.cancelBooking(
      { providerBookingId: "16161616", reason: null },
      { requestId: "req-already", config: runtimeConfig },
    );
    expect(result.outcome).toBe("CANCELLED");
    const postCalls = (http.request as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => call[0].request.path === "/v1/external/orders/cancel",
    );
    expect(postCalls).toHaveLength(0);
  });

  it("returns UNKNOWN preflight when AWB exists but status is missing", async () => {
    const http = {
      request: vi.fn(async (input: { request: { path: string } }) => {
        if (input.request.path.includes("/orders/show/")) {
          return {
            status: 200,
            data: {
              data: {
                id: 16161616,
                status: "UNKNOWN",
                awb_code: "SR123456789IN",
                shipments: [{ id: 15151515 }],
              },
            },
            headers: {},
            durationMs: 1,
          };
        }
        return { status: 204, data: {}, headers: {}, durationMs: 1 };
      }),
    } as unknown as ProviderHttpClient;

    const lifecycle = new ShiprocketLifecycleService(http, auth);
    const result = await lifecycle.cancelBooking(
      { providerBookingId: "16161616", reason: null },
      { requestId: "req-indeterminate", config: runtimeConfig },
    );
    expect(result.outcome).toBe("UNKNOWN");
    const postCalls = (http.request as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => call[0].request.path === "/v1/external/orders/cancel",
    );
    expect(postCalls).toHaveLength(0);
  });

  it("rejects pre-cancel when shipment is in transit without POST", async () => {
    const http = {
      request: vi.fn(async (input: { request: { path: string } }) => {
        if (input.request.path.includes("/orders/show/")) {
          return {
            status: 200,
            data: {
              data: {
                id: 16161616,
                status: "IN TRANSIT",
                shipments: [{ id: 15151515, status: "IN TRANSIT" }],
              },
            },
            headers: {},
            durationMs: 1,
          };
        }
        return { status: 204, data: {}, headers: {}, durationMs: 1 };
      }),
    } as unknown as ProviderHttpClient;

    const lifecycle = new ShiprocketLifecycleService(http, auth);
    const result = await lifecycle.cancelBooking(
      { providerBookingId: "16161616", reason: null },
      { requestId: "req-in-transit", config: runtimeConfig },
    );
    expect(result.outcome).toBe("REJECTED");
    const postCalls = (http.request as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => call[0].request.path === "/v1/external/orders/cancel",
    );
    expect(postCalls).toHaveLength(0);
  });
});
