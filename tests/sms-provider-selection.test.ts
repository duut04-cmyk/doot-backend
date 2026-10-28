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

  it("does not report ACCEPTED from NOOP fallback in production", async () => {
    vi.resetModules();
    vi.doMock("../src/config/env.js", () => ({
      env: {
        NODE_ENV: "production",
        SMS_PROVIDER: "msg91",
        MSG91_API_BASE_URL: "https://api.msg91.com/api/v5",
        MSG91_TIMEOUT_MS: 10_000,
      },
      getMsg91AccountTemplateId: () => undefined,
      getMsg91PickupTemplateId: () => undefined,
      getMsg91DeliveryTemplateId: () => undefined,
      isMsg91Configured: () => false,
      isTwilioConfigured: () => false,
    }));
    const { resolveOperationalSmsProvider } =
      await import("../src/infrastructure/sms/sms-provider.factory.js");
    const provider = resolveOperationalSmsProvider();
    expect(provider.name).toBe("NOOP");
    const result = await provider.sendMessage({
      notificationType: "PICKUP_OTP",
      recipientMobile: "919876543210",
      templateVariables: { otp: "123456" },
      correlationId: "corr-1",
      deliveryReference: "DEL-1",
    });
    expect(result.outcome).toBe("FAILED");
    vi.doUnmock("../src/config/env.js");
  });
});
