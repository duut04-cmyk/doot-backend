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

import { ProviderAdapterError } from "../src/modules/provider/contracts/provider-error.js";
import { ShiprocketAuthService } from "../src/modules/provider/adapters/shiprocket/shiprocket-auth.service.js";
import { InMemoryShiprocketAuthRefreshLock } from "../src/modules/provider/adapters/shiprocket/shiprocket-auth-refresh.lock.js";
import type { ProviderRuntimeConfig } from "../src/modules/provider/adapters/provider-config.types.js";
import { InMemoryProviderAuthTokenRepository } from "./helpers/in-memory-provider-auth-token.repository.js";

function createAuth(
  http: InstanceType<
    typeof import("../src/modules/provider/adapters/provider-http-client.js").ProviderHttpClient
  >,
) {
  return new ShiprocketAuthService(
    http,
    new InMemoryProviderAuthTokenRepository(),
    new InMemoryShiprocketAuthRefreshLock(),
  );
}

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

describe("ShiprocketAuthService", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("logs in and caches bearer token", async () => {
    const loginFixture = JSON.parse(
      readFileSync(join(fixtureDir, "auth-login-success.json"), "utf8"),
    );

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
    const auth = createAuth(http);
    auth.clearCacheForTests();

    const token = await auth.getBearerToken({
      config: runtimeConfig,
      requestId: "req-auth-1",
    });
    expect(token).toBe("sandbox-jwt-token-redacted");

    const cached = await auth.getBearerToken({
      config: runtimeConfig,
      requestId: "req-auth-2",
    });
    expect(cached).toBe(token);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("extracts top-level token from documented sandbox login shape", async () => {
    const loginFixture = JSON.parse(
      readFileSync(
        join(fixtureDir, "auth-login-sandbox-documented-shape.json"),
        "utf8",
      ),
    );

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
    const auth = createAuth(http);
    auth.clearCacheForTests();

    const token = await auth.getBearerToken({
      config: runtimeConfig,
      requestId: "req-auth-documented-shape",
    });
    expect(token).toBe("fixture-sandbox-jwt-placeholder-not-a-real-token");
  });

  it("maps 401 to PROVIDER_AUTHENTICATION_ERROR", async () => {
    const fetchMock = vi.fn(async () => new Response("Unauthorized", { status: 401 }));
    const { ProviderHttpClient } =
      await import("../src/modules/provider/adapters/provider-http-client.js");
    const http = new ProviderHttpClient(fetchMock as typeof fetch);
    const auth = createAuth(http);
    auth.clearCacheForTests();

    await expect(
      auth.getBearerToken({ config: runtimeConfig, requestId: "req-auth-401" }),
    ).rejects.toMatchObject({
      category: "PROVIDER_AUTHENTICATION_ERROR",
    } satisfies Partial<ProviderAdapterError>);
  });
});
