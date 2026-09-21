import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";

const envMock = vi.hoisted(() => ({
  MSG91_ENABLED: false,
  MSG91_AUTH_KEY: undefined as string | undefined,
  MSG91_SENDER_ID: undefined as string | undefined,
  MSG91_ACCOUNT_OTP_TEMPLATE_ID: undefined as string | undefined,
  MSG91_PICKUP_OTP_TEMPLATE_ID: undefined as string | undefined,
  MSG91_DELIVERY_OTP_TEMPLATE_ID: undefined as string | undefined,
  MSG91_API_BASE_URL: undefined as string | undefined,
  MSG91_TIMEOUT_MS: 10000,
}));

vi.mock("../src/config/env.js", () => ({
  env: envMock,
  isMsg91Configured: () =>
    Boolean(
      envMock.MSG91_AUTH_KEY &&
      envMock.MSG91_SENDER_ID &&
      envMock.MSG91_PICKUP_OTP_TEMPLATE_ID &&
      envMock.MSG91_DELIVERY_OTP_TEMPLATE_ID &&
      envMock.MSG91_API_BASE_URL,
    ),
  isMsg91AccountTemplateConfigured: () =>
    Boolean(envMock.MSG91_ACCOUNT_OTP_TEMPLATE_ID),
  getMsg91AccountTemplateId: () => envMock.MSG91_ACCOUNT_OTP_TEMPLATE_ID,
  getMsg91PickupTemplateId: () => envMock.MSG91_PICKUP_OTP_TEMPLATE_ID,
  getMsg91DeliveryTemplateId: () => envMock.MSG91_DELIVERY_OTP_TEMPLATE_ID,
}));

const { Msg91Service } = await import("../src/infrastructure/sms/msg91.service.js");

describe("Msg91Service configuration", () => {
  beforeEach(() => {
    envMock.MSG91_ENABLED = false;
    envMock.MSG91_AUTH_KEY = undefined;
    envMock.MSG91_SENDER_ID = undefined;
    envMock.MSG91_ACCOUNT_OTP_TEMPLATE_ID = undefined;
    envMock.MSG91_PICKUP_OTP_TEMPLATE_ID = undefined;
    envMock.MSG91_DELIVERY_OTP_TEMPLATE_ID = undefined;
    envMock.MSG91_API_BASE_URL = undefined;
  });

  it("reports disabled when MSG91_ENABLED is false", () => {
    const service = new Msg91Service();
    expect(service.isEnabled()).toBe(false);
    expect(() => service.assertReady("ACCOUNT_OTP")).toThrow(
      expect.objectContaining({
        code: ErrorCodes.SMS_NOT_CONFIGURED,
        message: "MSG91 SMS service is disabled.",
      }),
    );
  });

  it("requires auth key, sender ID, and template IDs when enabled", () => {
    envMock.MSG91_ENABLED = true;
    const service = new Msg91Service();

    expect(() => service.assertReady("ACCOUNT_OTP")).toThrow(
      expect.objectContaining({ code: ErrorCodes.SMS_NOT_CONFIGURED }),
    );

    envMock.MSG91_AUTH_KEY = "secret";
    envMock.MSG91_SENDER_ID = "DOOT";
    envMock.MSG91_API_BASE_URL = "https://api.msg91.com/api/v5";

    expect(() => service.assertReady("ACCOUNT_OTP")).toThrow(
      expect.objectContaining({ code: ErrorCodes.SMS_NOT_CONFIGURED }),
    );

    envMock.MSG91_ACCOUNT_OTP_TEMPLATE_ID = "account-template";
    expect(() => service.assertReady("ACCOUNT_OTP")).not.toThrow();
    expect(() => service.assertReady("PICKUP_OTP")).toThrow(
      expect.objectContaining({ code: ErrorCodes.SMS_NOT_CONFIGURED }),
    );
  });
});
