import { describe, expect, it, vi } from "vitest";
import { ProviderHttpClient } from "../src/modules/provider/adapters/provider-http-client.js";
import type { ProviderRuntimeConfig } from "../src/modules/provider/adapters/provider-config.types.js";
import {
  shiprocketAuthenticatedMutationRequest,
  shiprocketAuthenticatedReadRequest,
} from "../src/modules/provider/adapters/shiprocket/shiprocket-authenticated-http.util.js";
import type { ShiprocketAuthService } from "../src/modules/provider/adapters/shiprocket/shiprocket-auth.service.js";

const runtimeConfig: ProviderRuntimeConfig = {
  providerId: "provider-http",
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
  capabilities: ["SERVICEABILITY"],
  services: [],
  credentials: {},
};

describe("shiprocket authenticated HTTP", () => {
  it("read request retries once after 401 refresh", async () => {
    let readCalls = 0;
    const fetchMock = vi.fn(async () => {
      readCalls += 1;
      return new Response("{}", {
        status: readCalls === 1 ? 401 : 200,
        headers: { "content-type": "application/json" },
      });
    });
    const http = new ProviderHttpClient(fetchMock as typeof fetch);

    let getBearerCalls = 0;
    const auth = {
      getBearerToken: vi.fn(async (input: { forceRefresh?: boolean }) => {
        getBearerCalls += 1;
        return input.forceRefresh ? "token-after-refresh" : "token-stale";
      }),
      invalidateMemoryCache: vi.fn(),
    } as unknown as ShiprocketAuthService;

    const response = await shiprocketAuthenticatedReadRequest({
      http,
      auth,
      config: runtimeConfig,
      requestId: "req-read-401",
      operation: "getBooking",
      resourceLabel: "order",
      request: { method: "GET", path: "/v1/external/orders/show/1" },
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getBearerCalls).toBe(2);
    expect(auth.invalidateMemoryCache).toHaveBeenCalledWith(runtimeConfig.providerId);
  });

  it("mutation request does not retry on 401", async () => {
    const fetchMock = vi.fn(async () => new Response("Unauthorized", { status: 401 }));
    const http = new ProviderHttpClient(fetchMock as typeof fetch);
    const auth = {
      getBearerToken: vi.fn(async () => "mutation-token"),
    } as unknown as ShiprocketAuthService;

    const response = await shiprocketAuthenticatedMutationRequest({
      http,
      auth,
      config: runtimeConfig,
      requestId: "req-mutation-401",
      operation: "cancelBooking",
      request: {
        method: "POST",
        path: "/v1/external/orders/cancel",
        body: { ids: [1] },
      },
    });

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
