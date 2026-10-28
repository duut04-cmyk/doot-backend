import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { PaymentService } from "../src/modules/payment/payment.service.js";
import { ledgerIdempotencyKeyForRefund } from "../src/modules/payment/payment.constants.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryPaymentRepository } from "./helpers/in-memory-payment-repository.js";

describe("PaymentService.markRefundSuccessful", () => {
  let paymentRepo: InMemoryPaymentRepository;
  let service: PaymentService;
  let paymentId: string;
  let deliveryId: string;
  let refundId: string;

  beforeEach(async () => {
    paymentRepo = new InMemoryPaymentRepository();
    service = new PaymentService(
      paymentRepo,
      new InMemoryDeliveryRepository(),
      new InMemoryOrchestrationRepository(),
      "STUB",
    );
    deliveryId = randomUUID();
    const payment = await paymentRepo.createPayment({
      deliveryId,
      customerId: randomUUID(),
      amount: 100,
      currency: "INR",
      gateway: "CASHFREE",
      pricingSource: "ORCHESTRATION_QUOTE",
    });
    paymentId = payment.id;
    await paymentRepo.updatePaymentStatus({
      paymentId,
      fromStatuses: ["CREATED"],
      toStatus: "PAID",
      paidAt: new Date(),
    });
    const refund = await paymentRepo.createRefund({
      paymentId,
      deliveryId,
      amount: 100,
      currency: "INR",
      idempotencyKey: "refund-key-1",
      status: "PENDING",
    });
    refundId = refund.id;
  });

  it("marks refund, payment, and ledger atomically", async () => {
    const result = await service.markRefundSuccessful({
      refundId,
      gatewayRefundId: "cf-ref-1",
    });

    expect(result.status).toBe("SUCCESS");
    const payment = await paymentRepo.findById(paymentId);
    expect(payment?.status).toBe("REFUNDED");
    expect(payment?.refundedAmount).toBe(100);
    expect(paymentRepo.ledger.has(ledgerIdempotencyKeyForRefund(refundId))).toBe(true);
  });

  it("is idempotent for duplicate refund-success calls", async () => {
    await service.markRefundSuccessful({ refundId, gatewayRefundId: "cf-ref-1" });
    await service.markRefundSuccessful({ refundId, gatewayRefundId: "cf-ref-1" });

    const payment = await paymentRepo.findById(paymentId);
    expect(payment?.refundedAmount).toBe(100);
    expect(paymentRepo.ledger.size).toBe(1);
  });

  it("finalizes two distinct partial refunds concurrently without over-crediting", async () => {
    const refund40 = await paymentRepo.createRefund({
      paymentId,
      deliveryId,
      amount: 40,
      currency: "INR",
      idempotencyKey: "partial-40",
      status: "PENDING",
    });
    const refund60 = await paymentRepo.createRefund({
      paymentId,
      deliveryId,
      amount: 60,
      currency: "INR",
      idempotencyKey: "partial-60",
      status: "PENDING",
    });

    await Promise.all([
      service.markRefundSuccessful({
        refundId: refund40.id,
        gatewayRefundId: "cf-40",
      }),
      service.markRefundSuccessful({
        refundId: refund60.id,
        gatewayRefundId: "cf-60",
      }),
    ]);

    const payment = await paymentRepo.findById(paymentId);
    expect(payment?.refundedAmount).toBe(100);
    expect(payment?.status).toBe("REFUNDED");
    expect(paymentRepo.ledger.size).toBe(2);
  });

  it("handles concurrent duplicate webhooks without double increment", async () => {
    await Promise.all([
      service.markRefundSuccessful({ refundId, gatewayRefundId: "cf-ref-1" }),
      service.markRefundSuccessful({ refundId, gatewayRefundId: "cf-ref-1" }),
    ]);

    const payment = await paymentRepo.findById(paymentId);
    expect(payment?.refundedAmount).toBe(100);
    expect(paymentRepo.ledger.size).toBe(1);
  });

  it("repairs missing ledger when refund already SUCCESS", async () => {
    await paymentRepo.updateRefundStatus({
      refundId,
      fromStatuses: ["PENDING"],
      toStatus: "SUCCESS",
      processedAt: new Date(),
    });
    await paymentRepo.updatePaymentStatus({
      paymentId,
      fromStatuses: ["PAID"],
      toStatus: "REFUNDED",
      refundedAmount: 100,
    });

    await service.markRefundSuccessful({ refundId, gatewayRefundId: "cf-ref-1" });

    expect(paymentRepo.ledger.has(ledgerIdempotencyKeyForRefund(refundId))).toBe(true);
  });

  it("rolls back refund update when payment transition is invalid", async () => {
    await paymentRepo.updatePaymentStatus({
      paymentId,
      fromStatuses: ["PAID"],
      toStatus: "FAILED",
      failedAt: new Date(),
    });

    await expect(
      service.markRefundSuccessful({ refundId, gatewayRefundId: "cf-ref-1" }),
    ).rejects.toMatchObject({
      code: ErrorCodes.PAYMENT_INVALID_TRANSITION,
    });

    const refund = await paymentRepo.findRefundById(refundId);
    expect(refund?.status).toBe("PENDING");
    expect(paymentRepo.ledger.size).toBe(0);
  });

  it("does not leave inconsistent state when ledger already exists for pending refund", async () => {
    const ledgerKey = ledgerIdempotencyKeyForRefund(refundId);
    await paymentRepo.createLedgerEntry({
      deliveryId,
      paymentId,
      refundId,
      type: "REFUND",
      direction: "DEBIT",
      amount: 100,
      currency: "INR",
      idempotencyKey: ledgerKey,
    });

    const result = await service.markRefundSuccessful({
      refundId,
      gatewayRefundId: "cf-ref-1",
    });

    expect(result.status).toBe("SUCCESS");
    const payment = await paymentRepo.findById(paymentId);
    expect(payment?.status).toBe("REFUNDED");
    expect(payment?.refundedAmount).toBe(100);
    expect(paymentRepo.ledger.size).toBe(1);
  });
});
