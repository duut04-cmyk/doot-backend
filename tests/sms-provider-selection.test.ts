/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("resolveOperationalSmsProvider", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    process.env.NODE_ENV = "test";
    process.env.MSG91_ENABLED = "false";
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function loadFactory() {
    return import("../src/infrastructure/sms/sms-provider.factory.js");
  }

  it("selects MOCK when SMS_PROVIDER is mock", async () => {
    vi.stubEnv("SMS_PROVIDER", "mock");
    const { resolveOperationalSmsProvider } = await loadFactory();
    expect(resolveOperationalSmsProvider().name).toBe("MOCK");
  });

  it("selects TWILIO and not MSG91 when SMS_PROVIDER is twilio", async () => {
    vi.stubEnv("SMS_PROVIDER", "twilio");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACtest");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "secret");
    vi.stubEnv("TWILIO_FROM_NUMBER", "+15550001111");
    const { resolveOperationalSmsProvider } = await loadFactory();
    const provider = resolveOperationalSmsProvider();
    expect(provider.name).toBe("TWILIO");
    expect(provider.name).not.toBe("MSG91");
  });

  it("selects MSG91 when SMS_PROVIDER is msg91 and credentials exist", async () => {
    vi.stubEnv("SMS_PROVIDER", "msg91");
    vi.stubEnv("MSG91_AUTH_KEY", "key");
    vi.stubEnv("MSG91_SENDER_ID", "DOOT");
    vi.stubEnv("MSG91_PICKUP_OTP_TEMPLATE_ID", "pickup");
    vi.stubEnv("MSG91_DELIVERY_OTP_TEMPLATE_ID", "delivery");
    vi.stubEnv("MSG91_API_BASE_URL", "https://api.msg91.com/api/v5");
    const { resolveOperationalSmsProvider } = await loadFactory();
    expect(resolveOperationalSmsProvider().name).toBe("MSG91");
  });
});
