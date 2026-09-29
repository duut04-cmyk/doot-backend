import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { AppError } from "../src/core/errors/app-error.js";
import { PaymentService } from "../src/modules/payment/payment.service.js";
import { ledgerIdempotencyKeyForPaymentSuccess } from "../src/modules/payment/payment.constants.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryPaymentRepository } from "./helpers/in-memory-payment-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { seedOptionReadyDelivery } from "./helpers/booking-test-helpers.js";

describe("PaymentService", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let orchestrationRepo: InMemoryOrchestrationRepository;
  let providerRepo: InMemoryProviderRepository;
  let paymentRepo: InMemoryPaymentRepository;
  let customerId: string;
  let deliveryId: string;

  beforeEach(async () => {
    deliveryRepo = new InMemoryDeliveryRepository();
    orchestrationRepo = new InMemoryOrchestrationRepository();
    providerRepo = new InMemoryProviderRepository();
    paymentRepo = new InMemoryPaymentRepository();
    customerId = randomUUID();
    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
    });
    deliveryId = seeded.deliveryId;
  });

  function buildService() {
    return new PaymentService(paymentRepo, deliveryRepo, orchestrationRepo, "STUB");
  }

  it("creates payment from orchestration quote", async () => {
    const service = buildService();
    const result = await service.createPaymentForDelivery({
      deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: randomUUID(),
      requestHash: "hash",
    });

    expect(result.data.payment.amount).toBeGreaterThan(0);
    expect(result.data.payment.currency).toBe("INR");
    expect(result.data.payment.status).toBe("PENDING");
  });

  it("rejects duplicate active payment creation", async () => {
    const service = buildService();
    await service.createPaymentForDelivery({
      deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: randomUUID(),
      requestHash: "hash",
    });

    const second = await service.createPaymentForDelivery({
      deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: randomUUID(),
      requestHash: "hash",
    });

    expect(second.data.payment.status).toBe("PENDING");
  });

  it("marks payment paid and creates one ledger entry idempotently", async () => {
    const service = buildService();
    await service.createPaymentForDelivery({
      deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: randomUUID(),
      requestHash: "hash",
    });
    const payment = await paymentRepo.findByDeliveryId(deliveryId);
    expect(payment).toBeTruthy();

    await service.markPaymentPaid({ paymentId: payment!.id });
    await service.markPaymentPaid({ paymentId: payment!.id });

    const updated = await paymentRepo.findById(payment!.id);
    expect(updated?.status).toBe("PAID");
    expect(paymentRepo.ledger.size).toBe(1);
    expect(
      paymentRepo.ledger.has(ledgerIdempotencyKeyForPaymentSuccess(payment!.id)),
    ).toBe(true);
  });

  it("rejects refund over paid amount", async () => {
    const service = buildService();
    await service.createPaymentForDelivery({
      deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: randomUUID(),
      requestHash: "hash",
    });
    const payment = await paymentRepo.findByDeliveryId(deliveryId);
    await service.markPaymentPaid({ paymentId: payment!.id });

    await expect(
      service.requestRefund({
        paymentId: payment!.id,
        amount: payment!.amount + 1,
        idempotencyKey: "refund-1",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.REFUND_EXCEEDS_PAID,
    });
  });

  it("supports partial and full refunds", async () => {
    const service = buildService();
    await service.createPaymentForDelivery({
      deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: randomUUID(),
      requestHash: "hash",
    });
    const payment = await paymentRepo.findByDeliveryId(deliveryId);
    await service.markPaymentPaid({ paymentId: payment!.id });

    const partial = await service.requestRefund({
      paymentId: payment!.id,
      amount: 10,
      idempotencyKey: "partial-1",
    });
    await service.markRefundSuccessful({ refundId: partial.id });

    const afterPartial = await paymentRepo.findById(payment!.id);
    expect(afterPartial?.status).toBe("PARTIALLY_REFUNDED");
    expect(afterPartial?.refundedAmount).toBe(10);

    const fullRemainder = await service.requestRefund({
      paymentId: payment!.id,
      amount: payment!.amount - 10,
      idempotencyKey: "partial-2",
    });
    await service.markRefundSuccessful({ refundId: fullRemainder.id });

    const afterFull = await paymentRepo.findById(payment!.id);
    expect(afterFull?.status).toBe("REFUNDED");
    expect(afterFull?.refundedAmount).toBe(payment!.amount);
    expect(paymentRepo.ledger.size).toBe(3);
  });

  it("forbids another customer from reading payment", async () => {
    const service = buildService();
    await service.createPaymentForDelivery({
      deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: randomUUID(),
      requestHash: "hash",
    });

    await expect(
      service.getPaymentForDelivery({
        deliveryId,
        userId: randomUUID(),
        role: "CUSTOMER",
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("rejects invalid payment transition FAILED → PAID", async () => {
    const service = buildService();
    await service.createPaymentForDelivery({
      deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: randomUUID(),
      requestHash: "hash",
    });
    const payment = await paymentRepo.findByDeliveryId(deliveryId);
    await service.markPaymentFailed({ paymentId: payment!.id });

    await expect(
      service.markPaymentPaid({ paymentId: payment!.id }),
    ).rejects.toMatchObject({
      code: ErrorCodes.PAYMENT_INVALID_TRANSITION,
    });
  });
});
