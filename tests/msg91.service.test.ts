import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { logger } from "../src/config/logger.js";
import { Msg91Service } from "../src/infrastructure/sms/msg91.service.js";
import type { SmsProvider } from "../src/infrastructure/sms/sms.provider.js";

describe("Msg91Service", () => {
  let sendMessage: ReturnType<typeof vi.fn>;
  let provider: SmsProvider;

  beforeEach(() => {
    sendMessage = vi.fn(async () => ({
      outcome: "ACCEPTED" as const,
      providerRequestId: "req-1",
    }));
    provider = {
      name: "MSG91",
      sendMessage,
    };
  });

  function createService() {
    return new Msg91Service(provider);
  }

  it("sends account OTP with normalized phone and template variables", async () => {
    const service = createService();
    vi.spyOn(service, "assertReady").mockImplementation(() => undefined);

    await service.sendAccountOtp("9876543210", "123456", "corr-1");

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationType: "ACCOUNT_OTP",
        recipientMobile: "919876543210",
        templateVariables: { otp: "123456" },
        correlationId: "corr-1",
      }),
    );
  });

  it("supports pickup and delivery OTP helpers", async () => {
    const service = createService();
    vi.spyOn(service, "assertReady").mockImplementation(() => undefined);

    await service.sendPickupOtp("+919876543210", "111111");
    await service.sendDeliveryOtp("919876543210", "222222");

    expect(sendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ notificationType: "PICKUP_OTP" }),
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ notificationType: "DELIVERY_OTP" }),
    );
  });

  it("throws SMS_DELIVERY_FAILED when the provider rejects the request", async () => {
    sendMessage.mockResolvedValue({ outcome: "FAILED" });
    const service = createService();
    vi.spyOn(service, "assertReady").mockImplementation(() => undefined);

    await expect(service.sendAccountOtp("9876543210", "123456")).rejects.toMatchObject({
      code: ErrorCodes.SMS_DELIVERY_FAILED,
    });
  });

  it("does not log OTP values in sms attempt logs", async () => {
    const infoSpy = vi.spyOn(logger, "info");
    const service = createService();
    vi.spyOn(service, "assertReady").mockImplementation(() => undefined);

    await service.sendAccountOtp("9876543210", "123456", "corr-log");

    const payload = infoSpy.mock.calls.find(
      ([, message]) => message === "msg91_sms_attempted",
    )?.[0];
    expect(payload).toBeDefined();
    expect(JSON.stringify(payload)).not.toContain("123456");
    expect(JSON.stringify(payload)).not.toContain("secret-auth-key");
  });
});
