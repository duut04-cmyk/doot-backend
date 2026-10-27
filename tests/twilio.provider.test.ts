import { describe, expect, it, vi } from "vitest";
import { TwilioSmsProvider } from "../src/infrastructure/sms/twilio/twilio.provider.js";

describe("TwilioSmsProvider", () => {
  const config = {
    accountSid: "ACtest",
    authToken: "token",
    fromNumber: "+15551234567",
  };

  const baseInput = {
    notificationType: "PICKUP_OTP" as const,
    recipientMobile: "919876543210",
    correlationId: "corr-twilio-1",
    deliveryReference: "DOOT-3001",
    templateVariables: {
      otp: "654321",
      delivery_reference: "DOOT-3001",
      driver_name: "A",
      vehicle_type: "BIKE",
      vehicle_number: "X",
      driver_phone_masked: "****",
      event_type: "PICKUP",
    },
  };

  it("returns ACCEPTED with message SID on successful submission", async () => {
    const create = vi.fn(async () => ({ sid: "SM123", status: "queued" }));
    const provider = new TwilioSmsProvider(config, { create });

    const result = await provider.sendMessage(baseInput);

    expect(result.outcome).toBe("ACCEPTED");
    expect(result.providerRequestId).toBe("SM123");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "+15551234567",
        to: "+919876543210",
        body: expect.stringContaining("654321"),
      }),
    );
    expect(create.mock.calls[0]?.[0]?.body).toContain("pickup OTP");
  });

  it("uses delivery template for DELIVERY_OTP", async () => {
    const create = vi.fn(async () => ({ sid: "SM456" }));
    const provider = new TwilioSmsProvider(config, { create });

    await provider.sendMessage({
      ...baseInput,
      notificationType: "DELIVERY_OTP",
      templateVariables: {
        ...baseInput.templateVariables,
        event_type: "DELIVERY",
      },
    });

    expect(create.mock.calls[0]?.[0]?.body).toContain("delivery OTP");
  });

  it("maps 4xx provider errors to FAILED with diagnostics", async () => {
    const create = vi.fn(async () => {
      const error = new Error("Unable to create record") as Error & {
        status: number;
        code: number;
      };
      error.status = 400;
      error.code = 21608;
      throw error;
    });
    const provider = new TwilioSmsProvider(config, { create });

    const result = await provider.sendMessage(baseInput);
    expect(result.outcome).toBe("FAILED");
    expect(result.failureDiagnostics?.twilioErrorCode).toBe(21608);
    expect(result.failureDiagnostics?.httpStatus).toBe(400);
    expect(result.failureDiagnostics?.failureCategory).toBe("provider_rejection");
    expect(result.failureDiagnostics?.messageSidReturned).toBe(false);
  });

  it("maps 5xx provider errors to UNKNOWN", async () => {
    const create = vi.fn(async () => {
      const error = new Error("Server error") as Error & { status: number };
      error.status = 503;
      throw error;
    });
    const provider = new TwilioSmsProvider(config, { create });

    const result = await provider.sendMessage(baseInput);
    expect(result.outcome).toBe("UNKNOWN");
  });

  it("maps timeout-style errors to TIMEOUT", async () => {
    const create = vi.fn(async () => {
      const error = new Error("timeout") as Error & { status: number };
      error.status = 408;
      throw error;
    });
    const provider = new TwilioSmsProvider(config, { create });

    const result = await provider.sendMessage(baseInput);
    expect(result.outcome).toBe("TIMEOUT");
  });

  it("maps invalid recipient to FAILED without calling Twilio", async () => {
    const create = vi.fn(async () => ({ sid: "SM" }));
    const provider = new TwilioSmsProvider(config, { create });

    const result = await provider.sendMessage({
      ...baseInput,
      recipientMobile: "not-a-phone",
    });

    expect(result.outcome).toBe("FAILED");
    expect(result.failureDiagnostics?.failureCategory).toBe("invalid_recipient");
    expect(create).not.toHaveBeenCalled();
  });
});
