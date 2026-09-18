import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { MockProviderAdapter } from "../src/modules/provider/adapters/mock/mock-provider.adapter.js";
import {
  ProviderHttpClient,
  redactProviderHeaders,
} from "../src/modules/provider/adapters/provider-http-client.js";
import { ProviderAdapterRegistry } from "../src/modules/provider/adapters/provider-adapter-registry.js";
import { ProviderAdapterResolver } from "../src/modules/provider/adapters/provider-adapter-resolver.js";
import { ProviderConfigResolver } from "../src/modules/provider/adapters/provider-config-resolver.js";
import type { ProviderRuntimeConfig } from "../src/modules/provider/adapters/provider-config.types.js";
import { ProviderAdapterExecutor } from "../src/modules/provider/adapters/provider-adapter-executor.js";
import { ProviderIntegrationService } from "../src/modules/provider/provider.integration.service.js";
import { ProviderAdapterError } from "../src/modules/provider/contracts/provider-error.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { seedMockProvider } from "./helpers/provider-adapter-test-helpers.js";

const runtimeConfig = (): ProviderRuntimeConfig => ({
  providerId: "provider-1",
  providerCode: "MOCK",
  environment: "SANDBOX",
  status: "ACTIVE",
  enabled: true,
  integrationStatus: "READY",
  baseUrl: "https://mock-provider.test/sandbox",
  timeoutMs: 50,
  connectTimeoutMs: 10,
  maxRetries: 3,
  retryDelayMs: 1000,
  capabilities: [],
  services: [],
  credentials: { API_KEY: "secret-key" },
});

describe("Provider resilience", () => {
  describe("ProviderHttpClient", () => {
    it("maps aborted fetch to PROVIDER_TIMEOUT", async () => {
      const fetchImpl = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const error = new Error("The operation was aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      );

      const client = new ProviderHttpClient(fetchImpl as typeof fetch);

      await expect(
        client.request({
          config: runtimeConfig(),
          operation: "healthCheck",
          requestId: "req-http-timeout",
          request: { method: "GET", path: "" },
        }),
      ).rejects.toMatchObject({
        category: "PROVIDER_TIMEOUT",
        safeMessage: "Provider request timed out.",
      });
    });

    it("maps network failures to PROVIDER_UNKNOWN_ERROR", async () => {
      const client = new ProviderHttpClient(
        vi.fn().mockRejectedValue(new Error("network down")) as typeof fetch,
      );

      await expect(
        client.request({
          config: runtimeConfig(),
          operation: "getQuote",
          requestId: "req-http-network",
          request: { method: "POST", path: "/quote", body: {} },
        }),
      ).rejects.toMatchObject({
        category: "PROVIDER_UNKNOWN_ERROR",
      });
    });

    it("redacts sensitive headers from logs", () => {
      expect(
        redactProviderHeaders({
          authorization: "Bearer secret",
          "x-api-key": "abc",
          "content-type": "application/json",
        }),
      ).toEqual({
        authorization: "[REDACTED]",
        "x-api-key": "[REDACTED]",
        "content-type": "application/json",
      });
    });
  });

  describe("ProviderIntegrationService health checks", () => {
    let repo: InMemoryProviderRepository;
    let providerId: string;

    beforeEach(async () => {
      repo = new InMemoryProviderRepository();
      providerId = await seedMockProvider(repo, { integrationStatus: "READY" });
    });

    it("returns connected false when healthCheck throws ProviderAdapterError", async () => {
      const failingAdapter = {
        metadata: new MockProviderAdapter().metadata,
        supportsOperation: () => true,
        execute: vi.fn().mockRejectedValue(
          new ProviderAdapterError({
            providerCode: "MOCK",
            operation: "healthCheck",
            category: "PROVIDER_TIMEOUT",
            safeMessage: "Health check timed out.",
          }),
        ),
      };

      const registry = new ProviderAdapterRegistry();
      registry.register(failingAdapter as MockProviderAdapter);
      const resolver = new ProviderAdapterResolver(
        registry,
        new ProviderConfigResolver(repo),
      );
      const service = new ProviderIntegrationService(resolver);

      const result = await service.testConnection({
        providerId,
        requestId: "req-health-timeout",
      });

      expect(result.data.connected).toBe(false);
      expect(JSON.stringify(result)).not.toContain("secret-key");
    });

    it("returns connected true for healthy mock adapter", async () => {
      const registry = new ProviderAdapterRegistry();
      registry.register(new MockProviderAdapter());
      const resolver = new ProviderAdapterResolver(
        registry,
        new ProviderConfigResolver(repo),
      );
      const service = new ProviderIntegrationService(resolver);

      const result = await service.testConnection({
        providerId,
        requestId: "req-health-ok",
      });

      expect(result.data.connected).toBe(true);
    });
  });

  describe("ProviderAdapterExecutor retry config", () => {
    it("does not automatically retry failed adapter calls", async () => {
      const repo = new InMemoryProviderRepository();
      await seedMockProvider(repo, { integrationStatus: "READY" });

      const executeSpy = vi.fn().mockRejectedValue(
        new ProviderAdapterError({
          providerCode: "MOCK",
          operation: "healthCheck",
          category: "PROVIDER_SERVICE_UNAVAILABLE",
          safeMessage: "Unavailable.",
        }),
      );

      const registry = new ProviderAdapterRegistry();
      registry.register({
        metadata: new MockProviderAdapter().metadata,
        supportsOperation: () => true,
        execute: executeSpy,
      });
      const resolver = new ProviderAdapterResolver(
        registry,
        new ProviderConfigResolver(repo),
      );
      const executor = new ProviderAdapterExecutor(resolver);

      await expect(
        executor.execute({
          providerCode: "MOCK",
          operation: "healthCheck",
          payload: {},
          requestId: "req-no-retry",
        }),
      ).rejects.toMatchObject({
        code: ErrorCodes.PROVIDER_ADAPTER_ERROR,
      });

      expect(executeSpy).toHaveBeenCalledOnce();
    });
  });
});
