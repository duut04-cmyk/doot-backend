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
import { ShiprocketAuthService } from "../src/modules/provider/adapters/shiprocket/shiprocket-auth.service.js";
import { InMemoryShiprocketAuthRefreshLock } from "../src/modules/provider/adapters/shiprocket/shiprocket-auth-refresh.lock.js";
import type { ProviderRuntimeConfig } from "../src/modules/provider/adapters/provider-config.types.js";
import { InMemoryProviderAuthTokenRepository } from "./helpers/in-memory-provider-auth-token.repository.js";
import { SHIPROCKET_TOKEN_REFRESH_IF_REMAINING_MS } from "../src/modules/provider/adapters/shiprocket/shiprocket.constants.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/shiprocket");

const runtimeConfig: ProviderRuntimeConfig = {
  providerId: "provider-concurrency",
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

describe("ShiprocketAuthService concurrency hardening", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("worker B waits when worker A holds refresh lease and does not use first-login lock", async () => {
    const repo = new InMemoryProviderAuthTokenRepository();
    const lock = new InMemoryShiprocketAuthRefreshLock();
    const runExclusiveSpy = vi.spyOn(lock, "runFirstLoginExclusive");

    repo.seedStoredToken({
      providerId: runtimeConfig.providerId,
      encrypted: encryptCredential("seed"),
      expiresAt: new Date(Date.now() + SHIPROCKET_TOKEN_REFRESH_IF_REMAINING_MS - 1000),
      issuedAt: new Date(),
      refreshedAt: new Date(),
    });

    let loginCalls = 0;
    const fetchMock = vi.fn(async () => {
      loginCalls += 1;
      await new Promise((r) => setTimeout(r, 30));
      return new Response(JSON.stringify(loginResponse()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const { ProviderHttpClient } =
      await import("../src/modules/provider/adapters/provider-http-client.js");
    const http = new ProviderHttpClient(fetchMock as typeof fetch);

    const authA = new ShiprocketAuthService(http, repo, lock);
    const authB = new ShiprocketAuthService(http, repo, lock);
    authA.clearCacheForTests();
    authB.clearCacheForTests();

    const [tokenA, tokenB] = await Promise.all([
      authA.getBearerToken({ config: runtimeConfig, requestId: "worker-a" }),
      authB.getBearerToken({ config: runtimeConfig, requestId: "worker-b" }),
    ]);

    expect(tokenA).toBe(tokenB);
    expect(loginCalls).toBe(1);
    expect(runExclusiveSpy).not.toHaveBeenCalled();
  });

  it("worker A cannot persist when lease was lost before save", async () => {
    const repo = new InMemoryProviderAuthTokenRepository();
    const lock = new InMemoryShiprocketAuthRefreshLock();

    repo.seedStoredToken({
      providerId: runtimeConfig.providerId,
      encrypted: encryptCredential("worker-b-token"),
      expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      issuedAt: new Date(),
      refreshedAt: new Date(),
    });

    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(loginResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const { ProviderHttpClient } =
      await import("../src/modules/provider/adapters/provider-http-client.js");
    const http = new ProviderHttpClient(fetchMock as typeof fetch);
    const auth = new ShiprocketAuthService(http, repo, lock);
    auth.clearCacheForTests();

    const leaseToken = "worker-a-lease";
    expect(
      await repo.tryAcquireRefreshLease({
        providerId: runtimeConfig.providerId,
        leaseToken,
      }),
    ).toBe(true);

    await repo.releaseRefreshLease({
      providerId: runtimeConfig.providerId,
      leaseToken,
    });
    await repo.tryAcquireRefreshLease({
      providerId: runtimeConfig.providerId,
      leaseToken: "worker-b-lease",
    });

    const rowBefore = await repo.findByProviderId(runtimeConfig.providerId);
    const ciphertextBefore = rowBefore!.tokenCiphertext;

    type AuthInternals = {
      loginPersistAndCache: (input: unknown) => Promise<string>;
    };
    await expect(
      (auth as unknown as AuthInternals).loginPersistAndCache({
        config: runtimeConfig,
        requestId: "lost-lease",
        previousRow: rowBefore,
        persistence: { kind: "lease", leaseToken },
      }),
    ).resolves.toBe("worker-b-token");

    const rowAfter = await repo.findByProviderId(runtimeConfig.providerId);
    expect(rowAfter?.tokenCiphertext).toBe(ciphertextBefore);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("first-time login uses runFirstLoginExclusive and only one login occurs", async () => {
    const repo = new InMemoryProviderAuthTokenRepository();
    const lock = new InMemoryShiprocketAuthRefreshLock();
    let loginCalls = 0;
    const fetchMock = vi.fn(async () => {
      loginCalls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return new Response(JSON.stringify(loginResponse()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const { ProviderHttpClient } =
      await import("../src/modules/provider/adapters/provider-http-client.js");
    const http = new ProviderHttpClient(fetchMock as typeof fetch);
    const auth = new ShiprocketAuthService(http, repo, lock);
    auth.clearCacheForTests();

    const tokens = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        auth.getBearerToken({
          config: runtimeConfig,
          requestId: `first-login-${i}`,
        }),
      ),
    );
    expect(new Set(tokens).size).toBe(1);
    expect(loginCalls).toBe(1);
  });
});
