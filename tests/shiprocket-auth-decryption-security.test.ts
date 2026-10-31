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
import { logger } from "../src/config/logger.js";

const STORED_TOKEN = "stored-bearer-token-for-decrypt-test";

const runtimeConfig: ProviderRuntimeConfig = {
  providerId: "provider-decrypt-security",
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

describe("ShiprocketAuthService stored token decryption security", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not expose plaintext when stored ciphertext cannot be decrypted", async () => {
    const repo = new InMemoryProviderAuthTokenRepository();
    const encrypted = encryptCredential(STORED_TOKEN);
    const expiresAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    repo.seedStoredToken({
      providerId: runtimeConfig.providerId,
      encrypted: {
        ...encrypted,
        authTag: Buffer.from(encrypted.authTag, "base64").reverse().toString("base64"),
      },
      expiresAt,
      issuedAt: new Date(),
      refreshedAt: new Date(),
    });

    const fetchMock = vi.fn(async () => {
      throw new Error("login must not run when decrypt fails on fresh row");
    });
    const { ProviderHttpClient } =
      await import("../src/modules/provider/adapters/provider-http-client.js");
    const http = new ProviderHttpClient(fetchMock as typeof fetch);
    const auth = new ShiprocketAuthService(
      http,
      repo,
      new InMemoryShiprocketAuthRefreshLock(),
    );

    const infoSpy = vi.spyOn(logger, "info");
    const errorSpy = vi.spyOn(logger, "error");

    await expect(
      auth.getBearerToken({ config: runtimeConfig, requestId: "decrypt-fail-req" }),
    ).rejects.toThrow();

    expect(fetchMock).not.toHaveBeenCalled();
    const logBlob = JSON.stringify([...infoSpy.mock.calls, ...errorSpy.mock.calls]);
    expect(logBlob).not.toContain(STORED_TOKEN);
  });
});
