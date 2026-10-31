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
    },
  };
});

import { encryptCredential } from "../src/modules/provider/provider.crypto.js";
import { ProviderAdapterError } from "../src/modules/provider/contracts/provider-error.js";
import { ShiprocketAuthService } from "../src/modules/provider/adapters/shiprocket/shiprocket-auth.service.js";
import { InMemoryShiprocketAuthRefreshLock } from "../src/modules/provider/adapters/shiprocket/shiprocket-auth-refresh.lock.js";
import type { ProviderRuntimeConfig } from "../src/modules/provider/adapters/provider-config.types.js";
import { InMemoryProviderAuthTokenRepository } from "./helpers/in-memory-provider-auth-token.repository.js";
import { SHIPROCKET_TOKEN_REFRESH_IF_REMAINING_MS } from "../src/modules/provider/adapters/shiprocket/shiprocket.constants.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/shiprocket");

const runtimeConfig: ProviderRuntimeConfig = {
  providerId: "provider-id-persist",
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

function loginResponse() {
  return JSON.parse(readFileSync(join(fixtureDir, "auth-login-success.json"), "utf8"));
}

describe("ShiprocketAuthService persistence", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("cold start loads a valid database token without login", async () => {
    const repo = new InMemoryProviderAuthTokenRepository();
    const encrypted = encryptCredential("stored-token-value");
    const expiresAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    repo.seedStoredToken({
      providerId: runtimeConfig.providerId,
      encrypted,
      expiresAt,
      issuedAt: new Date(),
      refreshedAt: new Date(),
    });

    const fetchMock = vi.fn(async () => {
      throw new Error("login should not be called");
    });
    const { ProviderHttpClient } =
      await import("../src/modules/provider/adapters/provider-http-client.js");
    const http = new ProviderHttpClient(fetchMock as typeof fetch);
    const auth = new ShiprocketAuthService(
      http,
      repo,
      new InMemoryShiprocketAuthRefreshLock(),
    );

    const token = await auth.getBearerToken({
      config: runtimeConfig,
      requestId: "req-cold",
    });
    expect(token).toBe("stored-token-value");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("new auth service instance reuses stored token (restart simulation)", async () => {
    const repo = new InMemoryProviderAuthTokenRepository();
    const loginFixture = loginResponse();
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(loginFixture), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const { ProviderHttpClient } =
      await import("../src/modules/provider/adapters/provider-http-client.js");
    const http = new ProviderHttpClient(fetchMock as typeof fetch);
    const lock = new InMemoryShiprocketAuthRefreshLock();

    const auth1 = new ShiprocketAuthService(http, repo, lock);
    auth1.clearCacheForTests();
    await auth1.getBearerToken({ config: runtimeConfig, requestId: "req-1" });

    const auth2 = new ShiprocketAuthService(http, repo, lock);
    auth2.clearCacheForTests();
    const token = await auth2.getBearerToken({
      config: runtimeConfig,
      requestId: "req-2",
    });
    expect(token).toBe("sandbox-jwt-token-redacted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ten concurrent refresh requests produce only one login", async () => {
    const repo = new InMemoryProviderAuthTokenRepository();
    const loginFixture = loginResponse();
    let loginCalls = 0;
    const fetchMock = vi.fn(async () => {
      loginCalls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return new Response(JSON.stringify(loginFixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const { ProviderHttpClient } =
      await import("../src/modules/provider/adapters/provider-http-client.js");
    const http = new ProviderHttpClient(fetchMock as typeof fetch);
    const auth = new ShiprocketAuthService(
      http,
      repo,
      new InMemoryShiprocketAuthRefreshLock(),
    );
    auth.clearCacheForTests();

    const tokens = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        auth.getBearerToken({
          config: runtimeConfig,
          requestId: `req-concurrent-${index}`,
        }),
      ),
    );
    expect(new Set(tokens).size).toBe(1);
    expect(loginCalls).toBe(1);
  });

  it("refresh failure preserves a still-valid old token", async () => {
    const repo = new InMemoryProviderAuthTokenRepository();
    const encrypted = encryptCredential("old-valid-token");
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    repo.seedStoredToken({
      providerId: runtimeConfig.providerId,
      encrypted,
      expiresAt,
      issuedAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000),
      refreshedAt: new Date(),
    });

    const fetchMock = vi.fn(async () => new Response("Unauthorized", { status: 401 }));
    const { ProviderHttpClient } =
      await import("../src/modules/provider/adapters/provider-http-client.js");
    const http = new ProviderHttpClient(fetchMock as typeof fetch);
    const auth = new ShiprocketAuthService(
      http,
      repo,
      new InMemoryShiprocketAuthRefreshLock(),
    );
    auth.clearCacheForTests();
    auth.invalidateMemoryCache(runtimeConfig.providerId);

    const token = await auth.getBearerToken({
      config: runtimeConfig,
      requestId: "req-fallback",
      forceRefresh: true,
    });
    expect(token).toBe("old-valid-token");
  });

  it("refresh failure with expired token returns authentication error", async () => {
    const repo = new InMemoryProviderAuthTokenRepository();
    const encrypted = encryptCredential("expired-token");
    const expiresAt = new Date(Date.now() - 60_000);
    repo.seedStoredToken({
      providerId: runtimeConfig.providerId,
      encrypted,
      expiresAt,
      issuedAt: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000),
      refreshedAt: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000),
    });

    const fetchMock = vi.fn(async () => new Response("Unauthorized", { status: 401 }));
    const { ProviderHttpClient } =
      await import("../src/modules/provider/adapters/provider-http-client.js");
    const http = new ProviderHttpClient(fetchMock as typeof fetch);
    const auth = new ShiprocketAuthService(
      http,
      repo,
      new InMemoryShiprocketAuthRefreshLock(),
    );
    auth.clearCacheForTests();

    await expect(
      auth.getBearerToken({
        config: runtimeConfig,
        requestId: "req-expired",
        forceRefresh: true,
      }),
    ).rejects.toMatchObject({
      category: "PROVIDER_AUTHENTICATION_ERROR",
    } satisfies Partial<ProviderAdapterError>);
  });

  it("triggers refresh when inside 24-hour remaining window", async () => {
    const repo = new InMemoryProviderAuthTokenRepository();
    const encrypted = encryptCredential("near-expiry-token");
    const expiresAt = new Date(
      Date.now() + SHIPROCKET_TOKEN_REFRESH_IF_REMAINING_MS - 1000,
    );
    repo.seedStoredToken({
      providerId: runtimeConfig.providerId,
      encrypted,
      expiresAt,
      issuedAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000),
      refreshedAt: new Date(),
    });

    const loginFixture = loginResponse();
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(loginFixture), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const { ProviderHttpClient } =
      await import("../src/modules/provider/adapters/provider-http-client.js");
    const http = new ProviderHttpClient(fetchMock as typeof fetch);
    const auth = new ShiprocketAuthService(
      http,
      repo,
      new InMemoryShiprocketAuthRefreshLock(),
    );
    auth.clearCacheForTests();

    const token = await auth.getBearerToken({
      config: runtimeConfig,
      requestId: "req-refresh-window",
    });
    expect(token).toBe("sandbox-jwt-token-redacted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
