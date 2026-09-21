import { describe, expect, it, vi } from "vitest";
import { Msg91Client } from "../src/infrastructure/sms/msg91/msg91.client.js";
import { redactMsg91Headers } from "../src/infrastructure/sms/msg91/msg91.client.js";
import { Msg91SmsProvider } from "../src/infrastructure/sms/msg91/msg91.provider.js";

describe("MSG91 SMS provider", () => {
  const config = {
    baseUrl: "https://api.msg91.com/api/v5",
    authKey: "secret-auth-key",
    timeoutMs: 5000,
    senderId: "DOOTIN",
    accountTemplateId: "account-template",
    pickupTemplateId: "pickup-flow",
    deliveryTemplateId: "delivery-flow",
  };

  it("sends a flow request with template variables", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ type: "success", request_id: "req-123" }),
    );
    const provider = new Msg91SmsProvider(
      config,
      new Msg91Client(
        {
          baseUrl: config.baseUrl,
          authKey: config.authKey,
          timeoutMs: config.timeoutMs,
        },
        fetchImpl,
      ),
    );

    const result = await provider.sendMessage({
      notificationType: "PICKUP_OTP",
      recipientMobile: "919876543210",
      correlationId: "corr-1",
      deliveryReference: "DOTT-2001",
      templateVariables: {
        otp: "123456",
        delivery_reference: "DOTT-2001",
        driver_name: "Aman Singh",
        vehicle_type: "BIKE",
        vehicle_number: "PB10AB1234",
        driver_phone_masked: "****3210",
        event_type: "PICKUP",
      },
    });

    expect(result.outcome).toBe("ACCEPTED");
    expect(result.providerRequestId).toBe("req-123");
    expect(fetchImpl).toHaveBeenCalledOnce();

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authkey).toBe("secret-auth-key");

    const body = JSON.parse(String(init.body)) as {
      flow_id: string;
      recipients: Array<Record<string, string>>;
    };
    expect(body.flow_id).toBe("pickup-flow");
    expect(body.recipients[0]?.mobiles).toBe("919876543210");
    expect(body.recipients[0]?.otp).toBe("123456");
    expect(body.recipients[0]?.providerId).toBeUndefined();
  });

  it("uses the delivery flow id for delivery OTP notifications", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ type: "success", request_id: "req-456" }),
    );
    const provider = new Msg91SmsProvider(
      config,
      new Msg91Client(
        {
          baseUrl: config.baseUrl,
          authKey: config.authKey,
          timeoutMs: config.timeoutMs,
        },
        fetchImpl,
      ),
    );

    await provider.sendMessage({
      notificationType: "DELIVERY_OTP",
      recipientMobile: "919876543210",
      correlationId: "corr-2",
      deliveryReference: "DOTT-2002",
      templateVariables: {
        otp: "654321",
        delivery_reference: "DOTT-2002",
        driver_name: "Not assigned",
        vehicle_type: "Not available",
        vehicle_number: "Not available",
        driver_phone_masked: "Not available",
        event_type: "DELIVERY",
      },
    });

    const body = JSON.parse(
      String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body),
    ) as { flow_id: string };
    expect(body.flow_id).toBe("delivery-flow");
  });

  it("normalizes authentication failures without exposing secrets", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ type: "error", message: "Invalid authkey" }, { status: 401 }),
    );
    const provider = new Msg91SmsProvider(
      config,
      new Msg91Client(
        {
          baseUrl: config.baseUrl,
          authKey: config.authKey,
          timeoutMs: config.timeoutMs,
        },
        fetchImpl,
      ),
    );

    const result = await provider.sendMessage({
      notificationType: "PICKUP_OTP",
      recipientMobile: "919876543210",
      correlationId: "corr-3",
      deliveryReference: "DOTT-2003",
      templateVariables: {
        otp: "123456",
        delivery_reference: "DOTT-2003",
        driver_name: "Not assigned",
        vehicle_type: "Not available",
        vehicle_number: "Not available",
        driver_phone_masked: "Not available",
        event_type: "PICKUP",
      },
    });

    expect(result.outcome).toBe("FAILED");
  });

  it("uses the account template id for account OTP notifications", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ type: "success", request_id: "req-account" }),
    );
    const provider = new Msg91SmsProvider(
      config,
      new Msg91Client(
        {
          baseUrl: config.baseUrl,
          authKey: config.authKey,
          timeoutMs: config.timeoutMs,
        },
        fetchImpl,
      ),
    );

    await provider.sendMessage({
      notificationType: "ACCOUNT_OTP",
      recipientMobile: "919876543210",
      correlationId: "corr-account",
      deliveryReference: "TEST",
      templateVariables: { otp: "112233" },
    });

    const body = JSON.parse(
      String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body),
    ) as { flow_id: string; recipients: Array<Record<string, string>> };
    expect(body.flow_id).toBe("account-template");
    expect(body.recipients[0]?.otp).toBe("112233");
  });

  it("redacts auth headers in logsafe helper output", () => {
    expect(
      redactMsg91Headers({
        authkey: "secret",
        "content-type": "application/json",
      }),
    ).toEqual({
      authkey: "[REDACTED]",
      "content-type": "application/json",
    });
  });
});
