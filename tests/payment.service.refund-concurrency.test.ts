import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import type { PaymentGateway } from "../src/modules/payment/gateways/payment-gateway.interface.js";
import { PaymentService } from "../src/modules/payment/payment.service.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryPaymentRepository } from "./helpers/in-memory-payment-repository.js";

const gatewayMocks = vi.hoisted(() => ({
  createRefund: vi.fn<PaymentGateway["createRefund"]>(),
}));

vi.mock("../src/modules/payment/gateways/payment-gateway.registry.js", () => ({
  getPaymentGateway: () =>
    ({
      code: "STUB",
      createPaymentOrder: vi.fn(),
      getPaymentStatus: vi.fn(),
      verifyPayment: vi.fn(),
      createRefund: gatewayMocks.createRefund,
      getRefundStatus: vi.fn(),
    }) satisfies PaymentGateway,
}));

describe("PaymentService refund reservation concurrency", () => {
  let paymentRepo: InMemoryPaymentRepository;
  let paymentId: string;
  let service: PaymentService;

  beforeEach(async () => {
    gatewayMocks.createRefund.mockReset();
    gatewayMocks.createRefund.mockResolvedValue({
      gatewayRefundId: "gw-refund",
      gatewayRefundReference: "cf-ref",
      status: "SUCCESS",
    });

    paymentRepo = new InMemoryPaymentRepository();
    const deliveryId = randomUUID();
    const customerId = randomUUID();
    const payment = await paymentRepo.createPayment({
      deliveryId,
      customerId,
      amount: 100,
      currency: "INR",
      gateway: "STUB",
      pricingSource: "ORCHESTRATION_QUOTE",
    });
    paymentId = payment.id;
    await paymentRepo.updatePaymentStatus({
      paymentId,
      fromStatuses: ["CREATED"],
      toStatus: "PAID",
      gatewayOrderId: `order-${paymentId}`,
      paidAt: new Date(),
    });
    await paymentRepo.createLedgerEntry({
      deliveryId,
      paymentId,
      type: "CUSTOMER_PAYMENT",
      direction: "CREDIT",
      amount: 100,
      currency: "INR",
      idempotencyKey: `pay-success:${paymentId}`,
    });

    service = new PaymentService(
      paymentRepo,
      new InMemoryDeliveryRepository(),
      new InMemoryOrchestrationRepository(),
      "STUB",
    );
  });

  it("rejects concurrent refunds that exceed remaining balance", async () => {
    gatewayMocks.createRefund.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                gatewayRefundId: "gw-refund",
                status: "PENDING",
              }),
            20,
          );
        }),
    );

    const results = await Promise.allSettled([
      service.requestRefund({
        paymentId,
        amount: 60,
        idempotencyKey: "refund-a",
      }),
      service.requestRefund({
        paymentId,
        amount: 60,
        idempotencyKey: "refund-b",
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: ErrorCodes.REFUND_EXCEEDS_PAID }),
    });

    const active = [...paymentRepo.refunds.values()].filter(
      (r) =>
        r.paymentId === paymentId &&
        (r.status === "REQUESTED" || r.status === "PENDING" || r.status === "SUCCESS"),
    );
    expect(active).toHaveLength(1);
    expect(active[0]?.amount).toBe(60);
  });

  it("invokes gateway at most once for concurrent same idempotency key", async () => {
    gatewayMocks.createRefund.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                gatewayRefundId: "gw-same",
                status: "PENDING",
              }),
            15,
          );
        }),
    );

    await Promise.allSettled([
      service.requestRefund({
        paymentId,
        amount: 40,
        idempotencyKey: "concurrent-same-key",
      }),
      service.requestRefund({
        paymentId,
        amount: 40,
        idempotencyKey: "concurrent-same-key",
      }),
    ]);

    expect(gatewayMocks.createRefund).toHaveBeenCalledTimes(1);
    expect(paymentRepo.refunds.size).toBe(1);
  });

  it("does not invoke gateway when an existing REQUESTED refund is found", async () => {
    const deliveryId = (await paymentRepo.findById(paymentId))!.deliveryId;
    await paymentRepo.createRefund({
      paymentId,
      deliveryId,
      amount: 25,
      currency: "INR",
      idempotencyKey: "stuck-requested",
      status: "REQUESTED",
    });

    const result = await service.requestRefund({
      paymentId,
      amount: 25,
      idempotencyKey: "stuck-requested",
    });

    expect(result.status).toBe("REQUESTED");
    expect(gatewayMocks.createRefund).not.toHaveBeenCalled();
  });

  it("returns the same refund for repeated idempotency key without duplicate gateway calls", async () => {
    const first = await service.requestRefund({
      paymentId,
      amount: 40,
      idempotencyKey: "same-key",
    });
    const second = await service.requestRefund({
      paymentId,
      amount: 40,
      idempotencyKey: "same-key",
    });

    expect(second.id).toBe(first.id);
    expect(gatewayMocks.createRefund).toHaveBeenCalledTimes(1);
    expect(paymentRepo.refunds.size).toBe(1);
  });

  it("marks refund failed and releases reservation when gateway throws", async () => {
    gatewayMocks.createRefund.mockRejectedValue(new Error("gateway down"));

    await expect(
      service.requestRefund({
        paymentId,
        amount: 25,
        idempotencyKey: "fail-key",
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.PAYMENT_GATEWAY_ERROR });

    const refund = await paymentRepo.findRefundByIdempotencyKey("fail-key");
    expect(refund?.status).toBe("FAILED");
    expect(await paymentRepo.sumActiveRefundAmounts(paymentId)).toBe(0);
  });

  it("keeps reservation when gateway returns pending (unknown outcome)", async () => {
    gatewayMocks.createRefund.mockResolvedValue({
      gatewayRefundId: "gw-pending",
      status: "PENDING",
    });

    const refund = await service.requestRefund({
      paymentId,
      amount: 30,
      idempotencyKey: "pending-key",
    });

    expect(refund.status).toBe("PENDING");
    expect(await paymentRepo.sumActiveRefundAmounts(paymentId)).toBe(30);

    await expect(
      service.requestRefund({
        paymentId,
        amount: 80,
        idempotencyKey: "other-key",
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.REFUND_EXCEEDS_PAID });
  });

  it("finalizes successful refund and updates payment totals", async () => {
    const refund = await service.requestRefund({
      paymentId,
      amount: 100,
      idempotencyKey: "full-refund",
    });

    expect(refund.status).toBe("SUCCESS");
    const payment = await paymentRepo.findById(paymentId);
    expect(payment?.status).toBe("REFUNDED");
    expect(payment?.refundedAmount).toBe(100);
  });
});
