import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { logger } from "../src/config/logger.js";
import { SmsService } from "../src/infrastructure/sms/sms.service.js";
import type { SmsProvider } from "../src/infrastructure/sms/sms.provider.js";

describe("SmsService (operational OTP)", () => {
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

  function createService(isEnabled = true) {
    const service = new SmsService(provider);
    vi.spyOn(service, "isEnabled").mockReturnValue(isEnabled);
    return service;
  }

  const pickupInput = {
    recipientMobile: "919888877776",
    deliveryReference: "DOOT-1001",
    otp: "123456",
    correlationId: "corr-pickup",
    templateVariables: {
      driver_name: "A",
      vehicle_type: "BIKE",
      vehicle_number: "X",
      driver_phone_masked: "****",
      event_type: "PICKUP" as const,
    },
  };

  it("fails closed when SMS is disabled", async () => {
    const service = createService(false);
    await expect(service.sendPickupOtpSms(pickupInput)).rejects.toMatchObject({
      code: ErrorCodes.SMS_NOT_CONFIGURED,
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("uses pickup and delivery notification types", async () => {
    const service = createService();
    await service.sendPickupOtpSms(pickupInput);
    await service.sendDeliveryOtpSms({
      ...pickupInput,
      correlationId: "corr-delivery",
      templateVariables: { ...pickupInput.templateVariables, event_type: "DELIVERY" },
    });

    expect(sendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ notificationType: "PICKUP_OTP" }),
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ notificationType: "DELIVERY_OTP" }),
    );
    expect(sendMessage.mock.calls[0]?.[0]?.recipientMobile).toBe("919888877776");
  });

  it("resolves when provider returns ACCEPTED", async () => {
    const service = createService();
    await expect(service.sendPickupOtpSms(pickupInput)).resolves.toBeUndefined();
  });

  it("throws SMS_DELIVERY_FAILED with cause metadata for non-accepted outcomes", async () => {
    const service = createService();
    for (const outcome of ["FAILED", "TIMEOUT", "UNKNOWN"] as const) {
      sendMessage.mockResolvedValueOnce({ outcome });
      await expect(service.sendPickupOtpSms(pickupInput)).rejects.toMatchObject({
        code: ErrorCodes.SMS_DELIVERY_FAILED,
        cause: { smsOutcome: outcome },
      });
    }
  });

  it("does not log OTP values or full recipient numbers", async () => {
    const infoSpy = vi.spyOn(logger, "info");
    const service = createService();
    await service.sendPickupOtpSms(pickupInput);

    const payload = infoSpy.mock.calls.find(
      ([, message]) => message === "sms_notification_attempted",
    )?.[0];
    expect(payload).toBeDefined();
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("123456");
    expect(serialized).not.toContain("919888877776");
  });
});
