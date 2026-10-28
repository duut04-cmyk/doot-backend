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

  async function seedCreatedPaymentWithOrder(orderId: string, amount: number) {
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
      toStatus: "CREATED",
      gatewayOrderId: orderId,
      gatewayPaymentSessionId: "sess",
    });
    await paymentRepo.createAttempt({
      paymentId: created.id,
      attemptNumber: 1,
      amount,
      currency: "INR",
      gatewayOrderId: orderId,
      status: "CREATED",
    });
    return created.id;
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

  it("processes success webhook when payment is still CREATED", async () => {
    const orderId = "DOOT-order-created";
    const paymentId = await seedCreatedPaymentWithOrder(orderId, 100);
    const handler = buildHandler();
    const payload = {
      type: "PAYMENT_SUCCESS_WEBHOOK",
      data: {
        order: { order_id: orderId, order_amount: 100, order_currency: "INR" },
        payment: {
          cf_payment_id: "cf-created",
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
    const payment = await paymentRepo.findById(paymentId);
    expect(payment?.status).toBe("PAID");
    expect(paymentRepo.ledger.size).toBe(1);
  });

  it("processes success webhook and duplicate is idempotent", async () => {
    const orderId = "DOOT-order-1";
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

  it("rejects unknown Cashfree order", async () => {
    const handler = buildHandler();
    const signed = signedBody({
      type: "PAYMENT_SUCCESS_WEBHOOK",
      data: {
        order: { order_id: "DOOT-missing", order_amount: 10, order_currency: "INR" },
        payment: {
          payment_status: "SUCCESS",
          payment_amount: 10,
          cf_payment_id: "cf-x",
        },
      },
    });
    await expect(
      handler.handle({
        requestId: randomUUID(),
        rawBody: signed.rawBody,
        signature: signed.signature,
        timestamp: signed.timestamp,
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.PAYMENT_NOT_FOUND });
  });

  it("rejects currency mismatch", async () => {
    const orderId = "DOOT-order-currency";
    await seedPendingPayment(orderId, 100);
    const handler = buildHandler();
    const signed = signedBody({
      type: "PAYMENT_SUCCESS_WEBHOOK",
      data: {
        order: { order_id: orderId, order_amount: 100, order_currency: "USD" },
        payment: {
          payment_status: "SUCCESS",
          payment_amount: 100,
          cf_payment_id: "cf-curr",
        },
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

  it("rejects amount mismatch", async () => {
    const orderId = "DOOT-order-2";
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
    const orderId = "DOOT-order-3";
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

  it("processes refund success webhook (local simulation)", async () => {
    const orderId = "DOOT-order-refund-1";
    const paymentId = await seedPendingPayment(orderId, 100);
    const handler = buildHandler();
    const paySigned = signedBody({
      type: "PAYMENT_SUCCESS_WEBHOOK",
      data: {
        order: { order_id: orderId, order_amount: 100, order_currency: "INR" },
        payment: {
          cf_payment_id: "cf-pay",
          payment_status: "SUCCESS",
          payment_amount: 100,
        },
      },
    });
    await handler.handle({
      requestId: randomUUID(),
      rawBody: paySigned.rawBody,
      signature: paySigned.signature,
      timestamp: paySigned.timestamp,
    });

    const refund = await paymentRepo.createRefund({
      paymentId,
      deliveryId: (await paymentRepo.findById(paymentId))!.deliveryId,
      amount: 100,
      currency: "INR",
      idempotencyKey: "cancel-refund-test",
      status: "PENDING",
    });
    await paymentRepo.updateRefundStatus({
      refundId: refund.id,
      fromStatuses: ["PENDING"],
      toStatus: "PENDING",
      gatewayRefundId: "merchantRf1",
      gatewayRefundReference: "cf-rf-1",
    });

    const refundSigned = signedBody({
      type: "REFUND_STATUS_WEBHOOK",
      data: {
        order: { order_id: orderId, order_currency: "INR" },
        refund: {
          refund_id: "merchantRf1",
          cf_refund_id: "cf-rf-1",
          refund_status: "SUCCESS",
          refund_amount: 100,
          refund_currency: "INR",
        },
      },
    });
    await handler.handle({
      requestId: randomUUID(),
      rawBody: refundSigned.rawBody,
      signature: refundSigned.signature,
      timestamp: refundSigned.timestamp,
    });

    const updated = await paymentRepo.findRefundById(refund.id);
    expect(updated?.status).toBe("SUCCESS");
    const payment = await paymentRepo.findById(paymentId);
    expect(payment?.status).toBe("REFUNDED");
  });

  it("returns IGNORED for Cashfree dashboard WEBHOOK ping without payment data", async () => {
    const handler = buildHandler();
    const signed = signedBody({
      type: "WEBHOOK",
      event_time: "2026-10-10T06:08:13Z",
      data: {},
    });
    const result = await handler.handle({
      requestId: randomUUID(),
      rawBody: signed.rawBody,
      signature: signed.signature,
      timestamp: signed.timestamp,
    });
    expect(result).toMatchObject({
      processingStatus: "IGNORED",
      reason: "unsupported_webhook_type",
    });
    expect(paymentRepo.payments.size).toBe(0);
  });

  it("returns IGNORED for unsupported signed webhook (200 path)", async () => {
    const handler = buildHandler();
    const signed = signedBody({
      type: "VENDOR_SETTLEMENT_WEBHOOK",
      data: { order: { order_id: "DOOT-unknown" } },
    });
    const result = await handler.handle({
      requestId: randomUUID(),
      rawBody: signed.rawBody,
      signature: signed.signature,
      timestamp: signed.timestamp,
    });
    expect(result).toMatchObject({
      processingStatus: "IGNORED",
      reason: "unsupported_webhook_type",
    });
  });

  it("returns IGNORED for PAYMENT_CHARGES_WEBHOOK", async () => {
    const orderId = "DOOT-charges";
    await seedPendingPayment(orderId, 10);
    const handler = buildHandler();
    const signed = signedBody({
      type: "PAYMENT_CHARGES_WEBHOOK",
      data: {
        order: { order_id: orderId },
        payment: { payment_status: "SUCCESS", cf_payment_id: "99" },
      },
    });
    const result = await handler.handle({
      requestId: randomUUID(),
      rawBody: signed.rawBody,
      signature: signed.signature,
      timestamp: signed.timestamp,
    });
    expect(result.processingStatus).toBe("IGNORED");
    const payment = await paymentRepo.findByGatewayOrderId(orderId);
    expect(payment?.status).toBe("PENDING");
  });

  it("does not overwrite SUCCESS refund with later FAILED (local simulation)", async () => {
    const orderId = "DOOT-order-refund-2";
    const paymentId = await seedPendingPayment(orderId, 50);
    const handler = buildHandler();
    const paySigned = signedBody({
      type: "PAYMENT_SUCCESS_WEBHOOK",
      data: {
        order: { order_id: orderId, order_amount: 50, order_currency: "INR" },
        payment: {
          cf_payment_id: "cf-pay-2",
          payment_status: "SUCCESS",
          payment_amount: 50,
        },
      },
    });
    await handler.handle({
      requestId: randomUUID(),
      rawBody: paySigned.rawBody,
      signature: paySigned.signature,
      timestamp: paySigned.timestamp,
    });

    const refund = await paymentRepo.createRefund({
      paymentId,
      deliveryId: (await paymentRepo.findById(paymentId))!.deliveryId,
      amount: 50,
      currency: "INR",
      idempotencyKey: "refund-ooo",
      status: "PENDING",
    });
    await paymentRepo.updateRefundStatus({
      refundId: refund.id,
      fromStatuses: ["PENDING"],
      toStatus: "PENDING",
      gatewayRefundId: "merchantRf2",
    });

    const successSigned = signedBody({
      type: "REFUND_SUCCESS_WEBHOOK",
      data: {
        order: { order_id: orderId },
        refund: {
          refund_id: "merchantRf2",
          refund_status: "SUCCESS",
          refund_amount: 50,
        },
      },
    });
    await handler.handle({
      requestId: randomUUID(),
      rawBody: successSigned.rawBody,
      signature: successSigned.signature,
      timestamp: successSigned.timestamp,
    });

    const failedSigned = signedBody({
      type: "REFUND_FAILED_WEBHOOK",
      data: {
        order: { order_id: orderId },
        refund: {
          refund_id: "merchantRf2",
          refund_status: "FAILED",
          refund_amount: 50,
        },
      },
    });
    await handler.handle({
      requestId: randomUUID(),
      rawBody: failedSigned.rawBody,
      signature: failedSigned.signature,
      timestamp: failedSigned.timestamp,
    });

    const updated = await paymentRepo.findRefundById(refund.id);
    expect(updated?.status).toBe("SUCCESS");
  });
});
