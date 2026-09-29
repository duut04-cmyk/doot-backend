import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { webhookSecret } = vi.hoisted(() => ({
  webhookSecret: "cf-client-secret",
}));

vi.mock("../src/config/env.js", () => ({
  env: {
    CASHFREE_ENABLED: true,
    CASHFREE_ENVIRONMENT: "sandbox",
    CASHFREE_CLIENT_ID: "cf-client-id",
    CASHFREE_CLIENT_SECRET: webhookSecret,
    CASHFREE_WEBHOOK_ENABLED: true,
    CASHFREE_API_VERSION: "2025-01-01",
  },
  requireCashfreeCredentials: () => ({
    clientId: "cf-client-id",
    clientSecret: webhookSecret,
    apiVersion: "2025-01-01",
  }),
}));

import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { computeCashfreeWebhookSignature } from "../src/modules/payment/gateways/cashfree/cashfree-webhook.verify.js";
import { CashfreePaymentWebhookService } from "../src/modules/payment/webhook/cashfree-payment-webhook.service.js";
import { PaymentWebhookService } from "../src/modules/payment/webhook/payment-webhook.service.js";
import { PaymentService } from "../src/modules/payment/payment.service.js";
import { InMemoryPaymentRepository } from "./helpers/in-memory-payment-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";

describe("CashfreePaymentWebhookService", () => {
  let paymentRepo: InMemoryPaymentRepository;

  beforeEach(() => {
    paymentRepo = new InMemoryPaymentRepository();
  });

  function buildHandler() {
    const paymentService = new PaymentService(
      paymentRepo,
      new InMemoryDeliveryRepository(),
      new InMemoryOrchestrationRepository(),
      "CASHFREE",
    );
    const webhookService = new PaymentWebhookService(paymentService, paymentRepo);
    return new CashfreePaymentWebhookService(paymentRepo, webhookService);
  }

  async function seedPendingPayment(orderId: string, amount: number) {
    await paymentRepo.createPayment({
      deliveryId: randomUUID(),
      customerId: randomUUID(),
      amount,
      currency: "INR",
      gateway: "CASHFREE",
      pricingSource: {
        orchestrationRequestId: randomUUID(),
        orchestrationOptionId: randomUUID(),
        quoteSnapshot: { amount, currency: "INR" },
      },
    });
    const created = [...paymentRepo.payments.values()][0]!;
    await paymentRepo.updatePaymentStatus({
      paymentId: created.id,
      fromStatuses: ["CREATED"],
      toStatus: "PENDING",
      gatewayOrderId: orderId,
      gatewayPaymentSessionId: "sess",
    });
    await paymentRepo.createAttempt({
      paymentId: created.id,
      attemptNumber: 1,
      amount,
      currency: "INR",
      gatewayOrderId: orderId,
      status: "PENDING",
    });
    return created.id;
  }

  function signedBody(payload: unknown) {
    const timestamp = "1746427759733";
    const rawBody = JSON.stringify(payload);
    const signature = computeCashfreeWebhookSignature({
      timestamp,
      rawBody,
      secretKey: webhookSecret,
    });
    return { rawBody, timestamp, signature };
  }

  it("processes success webhook and duplicate is idempotent", async () => {
    const orderId = "DOTT-order-1";
    const paymentId = await seedPendingPayment(orderId, 100);
    const handler = buildHandler();
    const payload = {
      type: "PAYMENT_SUCCESS_WEBHOOK",
      data: {
        order: { order_id: orderId, order_amount: 100, order_currency: "INR" },
        payment: {
          cf_payment_id: "cf-1",
          payment_status: "SUCCESS",
          payment_amount: 100,
        },
      },
    };
    const signed = signedBody(payload);

    await handler.handle({
      requestId: randomUUID(),
      rawBody: signed.rawBody,
      signature: signed.signature,
      timestamp: signed.timestamp,
    });
    await handler.handle({
      requestId: randomUUID(),
      rawBody: signed.rawBody,
      signature: signed.signature,
      timestamp: signed.timestamp,
    });

    const payment = await paymentRepo.findById(paymentId);
    expect(payment?.status).toBe("PAID");
    expect(paymentRepo.ledger.size).toBe(1);
  });

  it("rejects invalid signature", async () => {
    const handler = buildHandler();
    await expect(
      handler.handle({
        requestId: randomUUID(),
        rawBody: "{}",
        signature: "bad",
        timestamp: "1",
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.CASHFREE_WEBHOOK_SIGNATURE_INVALID });
  });

  it("rejects amount mismatch", async () => {
    const orderId = "DOTT-order-2";
    await seedPendingPayment(orderId, 100);
    const handler = buildHandler();
    const signed = signedBody({
      data: {
        order: { order_id: orderId, order_amount: 100, order_currency: "INR" },
        payment: { payment_status: "SUCCESS", payment_amount: 50 },
      },
    });
    await expect(
      handler.handle({
        requestId: randomUUID(),
        rawBody: signed.rawBody,
        signature: signed.signature,
        timestamp: signed.timestamp,
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.PAYMENT_INVALID_AMOUNT });
  });

  it("ignores pending after success", async () => {
    const orderId = "DOTT-order-3";
    const paymentId = await seedPendingPayment(orderId, 80);
    const handler = buildHandler();
    const success = signedBody({
      data: {
        order: { order_id: orderId, order_amount: 80, order_currency: "INR" },
        payment: {
          payment_status: "SUCCESS",
          payment_amount: 80,
          cf_payment_id: "cf-2",
        },
      },
    });
    await handler.handle({
      requestId: randomUUID(),
      rawBody: success.rawBody,
      signature: success.signature,
      timestamp: success.timestamp,
    });

    const pending = signedBody({
      data: {
        order: { order_id: orderId, order_amount: 80, order_currency: "INR" },
        payment: { payment_status: "PENDING", payment_amount: 80 },
      },
    });
    await handler.handle({
      requestId: randomUUID(),
      rawBody: pending.rawBody,
      signature: pending.signature,
      timestamp: pending.timestamp,
    });

    const payment = await paymentRepo.findById(paymentId);
    expect(payment?.status).toBe("PAID");
  });
});
