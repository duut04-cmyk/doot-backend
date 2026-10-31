import { describe, expect, it, vi } from "vitest";
import { ProviderHttpClient } from "../src/modules/provider/adapters/provider-http-client.js";
import type { ProviderRuntimeConfig } from "../src/modules/provider/adapters/provider-config.types.js";
import { setShiprocketLiveLifecycleArtifactRecorder } from "../src/modules/provider/adapters/shiprocket/shiprocket-live-lifecycle-artifacts.js";

const shiprocketConfig: ProviderRuntimeConfig = {
  providerId: "p1",
  providerCode: "SHIPROCKET",
  environment: "LIVE",
  status: "ACTIVE",
  enabled: true,
  integrationStatus: "READY",
  baseUrl: "https://apiv2.shiprocket.in",
  timeoutMs: 50,
  connectTimeoutMs: 0,
  maxRetries: 0,
  retryDelayMs: 0,
  capabilities: [],
  services: [],
  credentials: {},
};

describe("ProviderHttpClient Shiprocket lifecycle artifacts", () => {
  it("records one exchange on HTTP 500 before throwing", async () => {
    const writes: unknown[] = [];
    setShiprocketLiveLifecycleArtifactRecorder({
      runId: "http-500",
      runDirectory: "/tmp/http-500",
      recordHttpExchange: async (exchange) => {
        writes.push(exchange);
      },
      recordDbSnapshot: async () => {},
    });

    const client = new ProviderHttpClient(
      vi.fn(
        async () => new Response(JSON.stringify({ message: "fail" }), { status: 500 }),
      ) as never,
    );

    await expect(
      client.request({
        config: shiprocketConfig,
        operation: "createBooking",
        requestId: "req-500",
        request: {
          method: "POST",
          path: "/v1/external/orders/create/adhoc",
          body: { order_id: "X" },
        },
      }),
    ).rejects.toThrow(/Provider HTTP request failed/);

    expect(writes).toHaveLength(1);
    expect((writes[0] as { outcome: string; status: number }).outcome).toBe(
      "http_error",
    );
    expect((writes[0] as { status: number }).status).toBe(500);
    setShiprocketLiveLifecycleArtifactRecorder(null);
  });

  it("records timeout outcome on abort", async () => {
    const writes: unknown[] = [];
    setShiprocketLiveLifecycleArtifactRecorder({
      runId: "http-timeout",
      runDirectory: "/tmp/http-timeout",
      recordHttpExchange: async (exchange) => {
        writes.push(exchange);
      },
      recordDbSnapshot: async () => {},
    });

    const client = new ProviderHttpClient(
      vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const error = new Error("Aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      ) as never,
    );

    await expect(
      client.request({
        config: { ...shiprocketConfig, timeoutMs: 5 },
        operation: "getBooking",
        requestId: "req-timeout",
        request: { method: "GET", path: "/v1/external/orders/show/1", timeoutMs: 5 },
      }),
    ).rejects.toThrow(/timed out/);

    expect(writes).toHaveLength(1);
    expect((writes[0] as { outcome: string }).outcome).toBe("timeout");
    setShiprocketLiveLifecycleArtifactRecorder(null);
  });

  it("records network failure when fetch rejects", async () => {
    const writes: unknown[] = [];
    setShiprocketLiveLifecycleArtifactRecorder({
      runId: "http-network",
      runDirectory: "/tmp/http-network",
      recordHttpExchange: async (exchange) => {
        writes.push(exchange);
      },
      recordDbSnapshot: async () => {},
    });

    const client = new ProviderHttpClient(
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }) as never,
    );

    await expect(
      client.request({
        config: shiprocketConfig,
        operation: "getTracking",
        requestId: "req-network",
        request: { method: "GET", path: "/v1/external/courier/track/awb/SR1" },
      }),
    ).rejects.toThrow(/Provider request failed/);

    expect(writes).toHaveLength(1);
    expect((writes[0] as { outcome: string }).outcome).toBe("network_error");
    setShiprocketLiveLifecycleArtifactRecorder(null);
  });

  it("records parse_error when a successful response is not valid JSON", async () => {
    const writes: unknown[] = [];
    setShiprocketLiveLifecycleArtifactRecorder({
      runId: "http-parse",
      runDirectory: "/tmp/http-parse",
      recordHttpExchange: async (exchange) => {
        writes.push(exchange);
      },
      recordDbSnapshot: async () => {},
    });

    const client = new ProviderHttpClient(
      vi.fn(async () => new Response("not-json", { status: 200 })) as never,
    );

    await expect(
      client.request({
        config: shiprocketConfig,
        operation: "getBooking",
        requestId: "req-parse",
        request: { method: "GET", path: "/v1/external/orders/show/1" },
      }),
    ).rejects.toThrow(/not valid JSON/);

    expect(writes).toHaveLength(1);
    expect((writes[0] as { outcome: string }).outcome).toBe("parse_error");
    setShiprocketLiveLifecycleArtifactRecorder(null);
  });

  it("does not duplicate artifacts when HTTP error is recorded then rethrown", async () => {
    const writes: unknown[] = [];
    setShiprocketLiveLifecycleArtifactRecorder({
      runId: "http-once",
      runDirectory: "/tmp/http-once",
      recordHttpExchange: async (exchange) => {
        writes.push(exchange);
      },
      recordDbSnapshot: async () => {},
    });

    const client = new ProviderHttpClient(
      vi.fn(
        async () => new Response(JSON.stringify({ error: true }), { status: 422 }),
      ) as never,
    );

    await expect(
      client.request({
        config: shiprocketConfig,
        operation: "cancelBooking",
        requestId: "req-422",
        request: {
          method: "POST",
          path: "/v1/external/orders/cancel",
          body: { ids: [1] },
        },
        allowErrorResponseBody: false,
      }),
    ).rejects.toThrow();

    expect(writes).toHaveLength(1);
    setShiprocketLiveLifecycleArtifactRecorder(null);
  });
});
