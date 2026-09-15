import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { CancellationService } from "../src/modules/cancellation/cancellation.service.js";
import { DeliveryLifecycleService } from "../src/modules/delivery/delivery-lifecycle.service.js";
import { ProviderAdapterExecutor } from "../src/modules/provider/adapters/provider-adapter-executor.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryCancellationRepository } from "./helpers/in-memory-cancellation-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { initializeProviderAdapters } from "../src/modules/provider/adapters/bootstrap.js";
import { seedBookedDelivery } from "./helpers/operational-test-helpers.js";
import { seedOptionReadyDelivery } from "./helpers/booking-test-helpers.js";

describe("CancellationService", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let bookingRepo: InMemoryBookingRepository;
  let providerRepo: InMemoryProviderRepository;
  let orchestrationRepo: InMemoryOrchestrationRepository;
  let cancellationRepo: InMemoryCancellationRepository;
  let executeMock: ReturnType<typeof vi.fn>;
  let service: CancellationService;
  const customerId = "44444444-4444-4444-8444-444444444444";

  beforeEach(() => {
    initializeProviderAdapters();
    deliveryRepo = new InMemoryDeliveryRepository();
    bookingRepo = new InMemoryBookingRepository();
    providerRepo = new InMemoryProviderRepository();
    orchestrationRepo = new InMemoryOrchestrationRepository();
    cancellationRepo = new InMemoryCancellationRepository();
    executeMock = vi.fn();
    service = new CancellationService(
      deliveryRepo,
      bookingRepo,
      providerRepo,
      cancellationRepo,
      new DeliveryLifecycleService(deliveryRepo),
      { execute: executeMock } as unknown as ProviderAdapterExecutor,
    );
  });

  it("cancels pre-booking delivery locally without provider call", async () => {
    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
    });

    const result = await service.cancel({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-cancel-local",
      reasonCode: "CUSTOMER_CHANGED_MIND",
      requestHash: "hash-local",
    });

    expect(result.data.delivery.status).toBe("CANCELLED");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("cancels booked delivery via provider adapter", async () => {
    executeMock.mockResolvedValue({
      success: true,
      outcome: "CANCELLED",
      providerCancellationId: "PC-1",
      status: "CANCELLED",
      reason: null,
      cancelledAt: new Date().toISOString(),
    });

    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });

    const result = await service.cancel({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-cancel-provider",
      reasonCode: "CUSTOMER_CHANGED_MIND",
      requestHash: "hash-provider",
    });

    expect(result.data.delivery.status).toBe("CANCELLED");
    expect(executeMock).toHaveBeenCalledOnce();
  });

  it("rejects cancellation when booking outcome is unknown", async () => {
    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });
    const booking = await bookingRepo.findLatestByDeliveryId(seeded.deliveryId);
    await bookingRepo.finalizeBooking({
      bookingId: booking!.id,
      status: "UNKNOWN",
      unknownOutcome: true,
    });

    await expect(
      service.cancel({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-cancel-unknown",
        reasonCode: "CUSTOMER_CHANGED_MIND",
        requestHash: "hash-unknown",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.PROVIDER_BOOKING_RECONCILIATION_REQUIRED,
    });
  });
});
