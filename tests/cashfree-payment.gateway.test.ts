import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config/env.js", () => ({
  env: {
    CASHFREE_ENABLED: true,
    CASHFREE_ENVIRONMENT: "sandbox",
    CASHFREE_CLIENT_ID: "cf-client-id",
    CASHFREE_CLIENT_SECRET: "cf-client-secret",
    CASHFREE_API_VERSION: "2025-01-01",
    CASHFREE_RETURN_URL: "https://example.com/return",
    CASHFREE_NOTIFY_URL: "https://example.com/webhook",
  },
  getCashfreePgBaseUrl: () => "https://sandbox.cashfree.com/pg",
  isCashfreeConfigured: () => true,
  requireCashfreeCredentials: () => ({
    clientId: "cf-client-id",
    clientSecret: "cf-client-secret",
    apiVersion: "2025-01-01",
  }),
}));

import * as envModule from "../src/config/env.js";
import { CashfreePaymentGateway } from "../src/modules/payment/gateways/cashfree-payment.gateway.js";

describe("CashfreePaymentGateway", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates order with correct URL, headers, and INR amount", async () => {
    const paymentId = randomUUID();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://sandbox.cashfree.com/pg/orders");
      const headers = init?.headers as Record<string, string>;
      expect(headers["x-client-id"]).toBe("cf-client-id");
      expect(headers["x-client-secret"]).toBe("cf-client-secret");
      expect(headers["x-api-version"]).toBe("2025-01-01");
      const body = JSON.parse(String(init?.body)) as {
        order_id: string;
        order_amount: number;
        order_currency: string;
        customer_details: { customer_phone?: string };
        order_meta?: { return_url?: string };
      };
      expect(body.customer_details.customer_phone).toBe("919876543210");
      expect(body.order_id).toBe(`DOOT-${paymentId}`);
      expect(body.order_amount).toBe(250.75);
      expect(body.order_currency).toBe("INR");
      expect(body.order_meta?.return_url).toContain("deliveryId=");
      return new Response(
        JSON.stringify({
          order_id: body.order_id,
          payment_session_id: "session_abc",
          order_status: "ACTIVE",
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const gateway = new CashfreePaymentGateway(fetchMock as typeof fetch);
    const deliveryId = randomUUID();
    const result = await gateway.createPaymentOrder({
      paymentId,
      deliveryId,
      amount: 250.75,
      currency: "INR",
      customerReference: "REF-1",
      customer: {
        customerId: randomUUID(),
        email: "user@example.com",
        phone: "+919876543210",
      },
    });

    expect(result.gatewayOrderId).toBe(`DOOT-${paymentId}`);
    expect(result.paymentSessionId).toBe("session_abc");
  });

  it("maps payment status query", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify([
          {
            cf_payment_id: "cf-1",
            payment_status: "SUCCESS",
            payment_group: "card",
          },
        ]),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new CashfreePaymentGateway(fetchMock as typeof fetch);
    const status = await gateway.getPaymentStatus({ gatewayOrderId: "DOOT-1" });
    expect(status.status).toBe("PAID");
    expect(status.gatewayPaymentId).toBe("cf-1");
  });

  it("fails when credentials missing", async () => {
    vi.spyOn(envModule, "requireCashfreeCredentials").mockImplementation(() => {
      throw new Error("missing");
    });
    const gateway = new CashfreePaymentGateway();
    await expect(
      gateway.createPaymentOrder({
        paymentId: randomUUID(),
        deliveryId: randomUUID(),
        amount: 10,
        currency: "INR",
        customerReference: "REF",
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_GATEWAY_NOT_CONFIGURED" });
  });

  it("fails on invalid create response", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ order_id: "x" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new CashfreePaymentGateway(fetchMock as typeof fetch);
    await expect(
      gateway.createPaymentOrder({
        paymentId: randomUUID(),
        deliveryId: randomUUID(),
        amount: 10,
        currency: "INR",
        customerReference: "REF",
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_GATEWAY_ERROR" });
  });

  it("creates refund against orders/{order_id}/refunds", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://sandbox.cashfree.com/pg/orders/DOOT-1/refunds");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body)) as {
        refund_id: string;
        refund_amount: number;
      };
      expect(body.refund_id).toBe("merchantRefundAbc");
      expect(body.refund_amount).toBe(40);
      return new Response(
        JSON.stringify({
          refund_id: "merchantRefundAbc",
          cf_refund_id: "cf-r-1",
          refund_status: "PENDING",
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new CashfreePaymentGateway(fetchMock as typeof fetch);
    const result = await gateway.createRefund({
      paymentId: randomUUID(),
      gatewayOrderId: "DOOT-1",
      amount: 40,
      currency: "INR",
      merchantRefundId: "merchantRefundAbc",
      idempotencyKey: "idem-r-1",
    });
    expect(result.status).toBe("PENDING");
    expect(result.gatewayRefundId).toBe("merchantRefundAbc");
    expect(result.gatewayRefundReference).toBe("cf-r-1");
  });

  it("gets refund status", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe(
        "https://sandbox.cashfree.com/pg/orders/DOOT-1/refunds/merchantRefundAbc",
      );
      return new Response(
        JSON.stringify({
          refund_id: "merchantRefundAbc",
          cf_refund_id: "cf-r-1",
          refund_status: "SUCCESS",
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new CashfreePaymentGateway(fetchMock as typeof fetch);
    const result = await gateway.getRefundStatus({
      gatewayOrderId: "DOOT-1",
      gatewayRefundId: "merchantRefundAbc",
    });
    expect(result.status).toBe("SUCCESS");
  });
});
