/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("dev-delivery-simulate.config", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    delete process.env.ENABLE_DEV_DELIVERY_SIMULATE;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.ENABLE_DEV_DELIVERY_SIMULATE;
  });

  async function loadConfig() {
    const mod =
      await import("../src/modules/dev-delivery-simulate/dev-delivery-simulate.config.js");
    return mod.isDevDeliverySimulateEnabled;
  }

  it("is disabled by default", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENABLE_DEV_DELIVERY_SIMULATE", "false");
    const isEnabled = await loadConfig();
    expect(isEnabled()).toBe(false);
  });

  it("is enabled in development when ENABLE_DEV_DELIVERY_SIMULATE is true", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENABLE_DEV_DELIVERY_SIMULATE", "true");
    const isEnabled = await loadConfig();
    expect(isEnabled()).toBe(true);
  });

  it("rejects startup when NODE_ENV is production and ENABLE_DEV_DELIVERY_SIMULATE is true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_ACCESS_SECRET", "x".repeat(32));
    vi.stubEnv("PAYMENT_GATEWAY", "cashfree");
    vi.stubEnv("CASHFREE_ENABLED", "true");
    vi.stubEnv("CASHFREE_CLIENT_ID", "cf-client-id");
    vi.stubEnv("CASHFREE_CLIENT_SECRET", "cf-client-secret");
    vi.stubEnv("CASHFREE_ENVIRONMENT", "sandbox");
    vi.stubEnv("SMS_PROVIDER", "twilio");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACtest123456789");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "twilio-auth-token");
    vi.stubEnv("TWILIO_FROM_NUMBER", "+15550001111");
    vi.stubEnv("ENABLE_DEV_DELIVERY_SIMULATE", "true");

    await expect(
      import("../src/modules/dev-delivery-simulate/dev-delivery-simulate.config.js"),
    ).rejects.toThrow(/Invalid environment configuration/);
  });
});
