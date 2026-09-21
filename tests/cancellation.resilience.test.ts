import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { initializeProviderAdapters } from "../src/modules/provider/adapters/bootstrap.js";
import { classifyCancellationError } from "../src/modules/cancellation/cancellation.provider-outcome.js";
import { CancellationService } from "../src/modules/cancellation/cancellation.service.js";
import { DeliveryLifecycleService } from "../src/modules/delivery/delivery-lifecycle.service.js";
import { ProviderAdapterExecutor } from "../src/modules/provider/adapters/provider-adapter-executor.js";
import { ProviderAdapterError } from "../src/modules/provider/contracts/provider-error.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryCancellationRepository } from "./helpers/in-memory-cancellation-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { seedBookedDelivery } from "./helpers/operational-test-helpers.js";

describe("Cancellation failure resilience", () => {
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

  it("classifies rate-limited provider errors as REJECTED for cancellation", () => {
    const resolved = classifyCancellationError(
      new ProviderAdapterError({
        providerCode: "MOCK",
        operation: "cancelBooking",
        category: "PROVIDER_RATE_LIMITED",
        safeMessage: "Rate limited.",
      }),
    );

    expect(resolved.outcome).toBe("REJECTED");
    expect(resolved.failureCode).toBe(ErrorCodes.PROVIDER_CANCELLATION_REJECTED);
  });

  it("does not mark delivery CANCELLED when provider rejects cancellation", async () => {
    executeMock.mockResolvedValue({
      success: false,
      outcome: "REJECTED",
      providerCancellationId: null,
      status: "ACTIVE",
      reason: "Too late.",
      cancelledAt: null,
    });

    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });

    await expect(
      service.cancel({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-cancel-resilience-reject",
        reasonCode: "CUSTOMER_CHANGED_MIND",
        requestHash: "hash-reject",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.PROVIDER_CANCELLATION_REJECTED,
    });

    const delivery = await deliveryRepo.findById(seeded.deliveryId);
    expect(delivery?.status).toBe("BOOKED");
    expect(cancellationRepo.cancellations[0]?.status).toBe("REJECTED");
  });

  it("blocks overlapping cancellation while provider call is in flight", async () => {
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });

    executeMock.mockImplementation(() =>
      providerGate.then(() => ({
        success: true,
        outcome: "CANCELLED",
        providerCancellationId: "PC-SLOW",
        status: "CANCELLED",
        reason: null,
        cancelledAt: new Date().toISOString(),
      })),
    );

    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });

    const first = service.cancel({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-cancel-concurrent-1",
      reasonCode: "CUSTOMER_CHANGED_MIND",
      requestHash: "hash-concurrent-1",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(
      service.cancel({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-cancel-concurrent-2",
        reasonCode: "CUSTOMER_CHANGED_MIND",
        requestHash: "hash-concurrent-2",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.CANCELLATION_IN_PROGRESS,
    });

    releaseProvider();
    await first;
    expect(executeMock).toHaveBeenCalledOnce();
  });
});
