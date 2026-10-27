import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderHttpClient } from "../src/modules/provider/adapters/provider-http-client.js";
import { ProviderAdapterError } from "../src/modules/provider/contracts/provider-error.js";
import { ShiprocketAuthService } from "../src/modules/provider/adapters/shiprocket/shiprocket-auth.service.js";
import {
  assertShiprocketSandboxHttpsBaseUrl,
  parseShiprocketProbeHttpBody,
  runShiprocketSandboxServiceabilityProbe,
  ShiprocketSandboxProbeError,
} from "../src/modules/provider/adapters/shiprocket/shiprocket-sandbox-probe.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/shiprocket");

const baseProbeInput = {
  baseUrl: "https://api-sandbox.shiprocket.in",
  weightKg: 1.2,
  pickup: {
    latitude: 28.509223937988,
    longitude: 77.067848205566,
    postcode: "110030",
  },
  drop: {
    latitude: 28.50724220275879,
    longitude: 77.06745147705078,
    postcode: "122002",
  },
  resolvePostcode: vi.fn(),
};

describe("Shiprocket sandbox probe", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects non-sandbox hosts before network calls", () => {
    expect(() =>
      assertShiprocketSandboxHttpsBaseUrl("https://apiv2.shiprocket.in"),
    ).toThrow(ShiprocketSandboxProbeError);

    expect(() =>
      assertShiprocketSandboxHttpsBaseUrl("http://api-sandbox.shiprocket.in"),
    ).toThrow(ShiprocketSandboxProbeError);
  });

  it("maps authentication failure to AUTHENTICATION without retrying serviceability", async () => {
    const auth = {
      getBearerToken: vi.fn(async () => {
        throw new ProviderAdapterError({
          providerCode: "SHIPROCKET",
          operation: "healthCheck",
          category: "PROVIDER_AUTHENTICATION_ERROR",
          safeMessage: "Shiprocket authentication failed.",
        });
      }),
    } as unknown as ShiprocketAuthService;

    const http = {
      request: vi.fn(),
    } as unknown as ProviderHttpClient;

    await expect(
      runShiprocketSandboxServiceabilityProbe({
        ...baseProbeInput,
        auth,
        http,
      }),
    ).rejects.toMatchObject({ code: "AUTHENTICATION" });

    expect(http.request).not.toHaveBeenCalled();
  });

  it("returns sanitized serviceability JSON on success", async () => {
    const serviceabilityFixture = JSON.parse(
      readFileSync(join(fixtureDir, "hyperlocal-serviceability-success.json"), "utf8"),
    );

    const auth = {
      getBearerToken: vi.fn(async () => "probe-token-not-logged"),
    } as unknown as ShiprocketAuthService;

    const http = {
      request: vi.fn(async () => ({
        status: 200,
        data: serviceabilityFixture,
        headers: {},
        durationMs: 12,
      })),
    } as unknown as ProviderHttpClient;

    const result = await runShiprocketSandboxServiceabilityProbe({
      ...baseProbeInput,
      auth,
      http,
    });

    expect(result.serviceabilityHttpStatus).toBe(200);
    expect(result.serviceabilityBody).toEqual(serviceabilityFixture);
    expect(http.request).toHaveBeenCalledTimes(1);
    expect(auth.getBearerToken).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed JSON responses", () => {
    expect(() => parseShiprocketProbeHttpBody("{not-json", 1024)).toThrow(
      ShiprocketSandboxProbeError,
    );
  });

  it("maps provider timeout to TIMEOUT", async () => {
    const auth = {
      getBearerToken: vi.fn(async () => "probe-token-not-logged"),
    } as unknown as ShiprocketAuthService;

    const http = {
      request: vi.fn(async () => {
        throw new ProviderAdapterError({
          providerCode: "SHIPROCKET",
          operation: "checkServiceability",
          category: "PROVIDER_TIMEOUT",
          safeMessage: "Provider request timed out.",
        });
      }),
    } as unknown as ProviderHttpClient;

    await expect(
      runShiprocketSandboxServiceabilityProbe({
        ...baseProbeInput,
        auth,
        http,
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});
