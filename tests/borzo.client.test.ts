import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { BorzoClient } from "../src/modules/provider/adapters/borzo/borzo.client.js";
import { BORZO_TEST_BASE_URL } from "../src/modules/provider/adapters/borzo/borzo.constants.js";
import { ProviderHttpClient } from "../src/modules/provider/adapters/provider-http-client.js";
import type { ProviderRuntimeConfig } from "../src/modules/provider/adapters/provider-config.types.js";
import {
  failedBorzoCalculateOrderResponse,
  sampleQuoteRequest,
  successfulBorzoCalculateOrderResponse,
} from "./helpers/borzo-test-fixtures.js";
import { mapQuoteRequestToBorzoCalculateOrder } from "../src/modules/provider/adapters/borzo/borzo.mapper.js";

function buildConfig(
  overrides?: Partial<ProviderRuntimeConfig>,
): ProviderRuntimeConfig {
  return {
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
    ...overrides,
  };
}

describe("Borzo client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: BorzoClient;

  beforeEach(() => {
    fetchMock = vi.fn();
    client = new BorzoClient(new ProviderHttpClient(fetchMock as typeof fetch));
  });

  it("sends X-DV-Auth-Token header on calculate-order", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(successfulBorzoCalculateOrderResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await client.calculateOrder({
      config: buildConfig(),
      requestId: "req-borzo-1",
      body: mapQuoteRequestToBorzoCalculateOrder(sampleQuoteRequest),
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-DV-Auth-Token"]).toBe("secret-borzo-token");
  });

  it("never exposes token in thrown errors", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ is_successful: false }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );

    const error = await client
      .calculateOrder({
        config: buildConfig(),
        requestId: "req-borzo-2",
        body: mapQuoteRequestToBorzoCalculateOrder(sampleQuoteRequest),
      })
      .catch((err) => err);

    expect(error).toMatchObject({
      category: "PROVIDER_AUTHENTICATION_ERROR",
    });
    expect(String(error)).not.toContain("secret-borzo-token");
  });

  it("parses HTTP 400 calculate-order validation body", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(failedBorzoCalculateOrderResponse), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await client.calculateOrder({
      config: buildConfig(),
      requestId: "req-borzo-3",
      body: mapQuoteRequestToBorzoCalculateOrder(sampleQuoteRequest),
    });
    expect(response.is_successful).toBe(false);
  });

  it("fails when token is missing", async () => {
    await expect(
      client.calculateOrder({
        config: buildConfig({ credentials: {} }),
        requestId: "req-borzo-4",
        body: mapQuoteRequestToBorzoCalculateOrder(sampleQuoteRequest),
      }),
    ).rejects.toMatchObject({
      category: "PROVIDER_AUTHENTICATION_ERROR",
    });
  });

  it("blocks LIVE environment", async () => {
    await expect(
      client.ping({
        config: buildConfig({ environment: "LIVE" }),
        requestId: "req-borzo-5",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.PROVIDER_CONFIGURATION_INVALID,
    });
  });

  it("handles timeout via abort", async () => {
    fetchMock.mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("Aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    });

    await expect(
      client.calculateOrder({
        config: buildConfig({ timeoutMs: 10 }),
        requestId: "req-borzo-6",
        body: mapQuoteRequestToBorzoCalculateOrder(sampleQuoteRequest),
      }),
    ).rejects.toMatchObject({
      category: "PROVIDER_TIMEOUT",
    });
  });

  it("rejects malformed calculate-order response", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ unexpected: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      client.calculateOrder({
        config: buildConfig(),
        requestId: "req-borzo-7",
        body: mapQuoteRequestToBorzoCalculateOrder(sampleQuoteRequest),
      }),
    ).rejects.toMatchObject({
      safeMessage: "Borzo calculate-order response was malformed.",
    });
  });

  it("pings base URL for health check", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ is_successful: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await client.ping({
      config: buildConfig(),
      requestId: "req-borzo-8",
    });
    expect(result.healthy).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(BORZO_TEST_BASE_URL);
  });
});
