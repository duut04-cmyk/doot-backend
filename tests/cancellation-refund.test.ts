import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { refundPrepaidAfterCancellation } from "../src/modules/cancellation/cancellation-refund.js";
import { PaymentService } from "../src/modules/payment/payment.service.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryPaymentRepository } from "./helpers/in-memory-payment-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { seedOptionReadyDelivery } from "./helpers/booking-test-helpers.js";

describe("refundPrepaidAfterCancellation", () => {
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

  it("refunds remaining prepaid amount after cancel", async () => {
    const paymentSvc = new PaymentService(
      paymentRepo,
      deliveryRepo,
      orchestrationRepo,
      "STUB",
    );
    await paymentSvc.createPaymentForDelivery({
      deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: randomUUID(),
      requestHash: "hash",
    });
    const payment = await paymentRepo.findByDeliveryId(deliveryId);
    const cancellationId = randomUUID();

    const summary = await refundPrepaidAfterCancellation({
      deliveryId,
      cancellationId,
      reasonCode: "CUSTOMER_CHANGED_MIND",
      payments: paymentRepo,
      paymentSvc,
    });

    expect(summary?.status).toBe("SUCCESS");
    expect(summary?.amount).toBe(payment!.amount);
    expect(summary?.refundId).toBeTruthy();

    const again = await refundPrepaidAfterCancellation({
      deliveryId,
      cancellationId,
      reasonCode: "CUSTOMER_CHANGED_MIND",
      payments: paymentRepo,
      paymentSvc,
    });
    expect(again?.refundId).toBe(summary?.refundId);
  });

  it("skips when no payment", async () => {
    const summary = await refundPrepaidAfterCancellation({
      deliveryId,
      cancellationId: randomUUID(),
      reasonCode: "CUSTOMER_CHANGED_MIND",
      payments: paymentRepo,
      paymentSvc: new PaymentService(
        paymentRepo,
        deliveryRepo,
        orchestrationRepo,
        "STUB",
      ),
    });
    expect(summary).toBeNull();
  });

  it("returns failure summary when gateway refund fails after cancel", async () => {
    const paymentSvc = new PaymentService(
      paymentRepo,
      deliveryRepo,
      orchestrationRepo,
      "STUB",
    );
    await paymentSvc.createPaymentForDelivery({
      deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: randomUUID(),
      requestHash: "hash",
    });

    vi.spyOn(paymentSvc, "requestRefund").mockRejectedValue(new Error("gateway down"));

    const summary = await refundPrepaidAfterCancellation({
      deliveryId,
      cancellationId: randomUUID(),
      reasonCode: "CUSTOMER_CHANGED_MIND",
      payments: paymentRepo,
      paymentSvc,
    });

    expect(summary?.status).toBe("FAILED");
    expect(summary?.failureMessage).toMatch(/gateway down/);
  });
});
