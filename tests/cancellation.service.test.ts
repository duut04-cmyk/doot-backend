import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { CancellationService } from "../src/modules/cancellation/cancellation.service.js";
import { DeliveryLifecycleService } from "../src/modules/delivery/delivery-lifecycle.service.js";
import { initializeProviderAdapters } from "../src/modules/provider/adapters/bootstrap.js";
import { ProviderAdapterExecutor } from "../src/modules/provider/adapters/provider-adapter-executor.js";
import { ProviderAdapterError } from "../src/modules/provider/contracts/provider-error.js";
import { seedOptionReadyDelivery } from "./helpers/booking-test-helpers.js";
import {
  seedCreatedDelivery,
  seedOrchestratingDelivery,
} from "./helpers/cancellation-test-helpers.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryCancellationRepository } from "./helpers/in-memory-cancellation-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { seedDriverAssignedDelivery } from "./helpers/otp-test-helpers.js";
import {
  seedBookedDelivery,
  seedDeliveredDelivery,
} from "./helpers/operational-test-helpers.js";

describe("CancellationService", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let bookingRepo: InMemoryBookingRepository;
  let providerRepo: InMemoryProviderRepository;
  let orchestrationRepo: InMemoryOrchestrationRepository;
  let cancellationRepo: InMemoryCancellationRepository;
  let executeMock: ReturnType<typeof vi.fn>;
  let service: CancellationService;
  const customerId = "44444444-4444-4444-8444-444444444444";
  const otherCustomerId = "55555555-5555-5555-8555-555555555555";

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

  function mockProviderCancelSuccess() {
    executeMock.mockResolvedValue({
      success: true,
      outcome: "CANCELLED",
      providerCancellationId: "PC-1",
      status: "CANCELLED",
      reason: null,
      cancelledAt: new Date().toISOString(),
    });
  }

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

  it("cancels CREATED delivery locally without provider call", async () => {
    const seeded = await seedCreatedDelivery({ deliveryRepo, customerId });

    const result = await service.cancel({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-cancel-created",
      reasonCode: "CUSTOMER_CHANGED_MIND",
      requestHash: "hash-created",
    });

    expect(result.data.delivery.status).toBe("CANCELLED");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("cancels ORCHESTRATING delivery locally without provider call", async () => {
    const seeded = await seedOrchestratingDelivery({ deliveryRepo, customerId });

    const result = await service.cancel({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-cancel-orchestrating",
      reasonCode: "DELIVERY_NO_LONGER_REQUIRED",
      requestHash: "hash-orchestrating",
    });

    expect(result.data.delivery.status).toBe("CANCELLED");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("cancels booked delivery via provider adapter", async () => {
    mockProviderCancelSuccess();

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

  it("cancels DRIVER_ASSIGNED delivery via provider adapter", async () => {
    mockProviderCancelSuccess();

    const seeded = await seedDriverAssignedDelivery({
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
      requestId: "req-cancel-driver-assigned",
      reasonCode: "PROVIDER_DELAY",
      requestHash: "hash-driver-assigned",
    });

    expect(result.data.delivery.status).toBe("CANCELLED");
    expect(executeMock).toHaveBeenCalledOnce();
  });

  it("cancels PICKUP_OTP_PENDING delivery via provider adapter", async () => {
    mockProviderCancelSuccess();

    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });
    await deliveryRepo.transitionStatus({
      deliveryId: seeded.deliveryId,
      expectedFromStatuses: ["BOOKED"],
      toStatus: "PICKUP_OTP_PENDING",
      source: "OTP",
      reason: "test",
    });

    const result = await service.cancel({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-cancel-pickup-otp-pending",
      reasonCode: "CUSTOMER_CHANGED_MIND",
      requestHash: "hash-pickup-otp-pending",
    });

    expect(result.data.delivery.status).toBe("CANCELLED");
    expect(executeMock).toHaveBeenCalledOnce();
  });

  async function seedPostPickupDelivery(
    targetStatus: "IN_TRANSIT" | "DELIVERY_OTP_PENDING",
  ) {
    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });
    await deliveryRepo.transitionStatus({
      deliveryId: seeded.deliveryId,
      expectedFromStatuses: ["BOOKED"],
      toStatus: "DRIVER_ASSIGNED",
      source: "TRACKING",
      reason: "test",
    });
    await deliveryRepo.transitionStatus({
      deliveryId: seeded.deliveryId,
      expectedFromStatuses: ["DRIVER_ASSIGNED"],
      toStatus: "PICKUP_OTP_PENDING",
      source: "OTP",
      reason: "test",
    });
    await deliveryRepo.transitionStatus({
      deliveryId: seeded.deliveryId,
      expectedFromStatuses: ["PICKUP_OTP_PENDING"],
      toStatus: "PICKED_UP",
      source: "OTP",
      reason: "test",
    });
    if (targetStatus === "IN_TRANSIT") {
      await deliveryRepo.transitionStatus({
        deliveryId: seeded.deliveryId,
        expectedFromStatuses: ["PICKED_UP"],
        toStatus: "IN_TRANSIT",
        source: "TRACKING",
        reason: "test",
      });
    } else {
      await deliveryRepo.transitionStatus({
        deliveryId: seeded.deliveryId,
        expectedFromStatuses: ["PICKED_UP"],
        toStatus: "IN_TRANSIT",
        source: "TRACKING",
        reason: "test",
      });
      await deliveryRepo.transitionStatus({
        deliveryId: seeded.deliveryId,
        expectedFromStatuses: ["IN_TRANSIT"],
        toStatus: "DELIVERY_OTP_PENDING",
        source: "OTP",
        reason: "test",
      });
    }
    return seeded;
  }

  it.each(["IN_TRANSIT", "DELIVERY_OTP_PENDING"] as const)(
    "rejects cancellation after pickup (%s)",
    async (targetStatus) => {
      mockProviderCancelSuccess();
      const seeded = await seedPostPickupDelivery(targetStatus);

      await expect(
        service.cancel({
          deliveryId: seeded.deliveryId,
          userId: customerId,
          role: "CUSTOMER",
          requestId: `req-cancel-${targetStatus}`,
          reasonCode: "CUSTOMER_CHANGED_MIND",
          requestHash: `hash-${targetStatus}`,
        }),
      ).rejects.toMatchObject({
        code: ErrorCodes.CANCELLATION_NOT_ALLOWED,
      });
      expect(executeMock).not.toHaveBeenCalled();
    },
  );

  it("rejects cancellation for delivered delivery", async () => {
    mockProviderCancelSuccess();
    const seeded = await seedDeliveredDelivery({
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
        requestId: "req-cancel-delivered",
        reasonCode: "CUSTOMER_CHANGED_MIND",
        requestHash: "hash-delivered",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.CANCELLATION_NOT_ALLOWED,
    });
  });

  it("rejects repeated cancellation on already cancelled delivery", async () => {
    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
    });

    await service.cancel({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-cancel-first",
      reasonCode: "CUSTOMER_CHANGED_MIND",
      requestHash: "hash-first",
    });

    await expect(
      service.cancel({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-cancel-repeat",
        reasonCode: "CUSTOMER_CHANGED_MIND",
        requestHash: "hash-repeat",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.CANCELLATION_NOT_ALLOWED,
    });
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

  it("rejects cancellation when provider returns REJECTED outcome", async () => {
    executeMock.mockResolvedValue({
      success: false,
      outcome: "REJECTED",
      providerCancellationId: null,
      status: "ACTIVE",
      reason: "Too late to cancel",
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
        requestId: "req-cancel-rejected",
        reasonCode: "CUSTOMER_CHANGED_MIND",
        requestHash: "hash-rejected",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.PROVIDER_CANCELLATION_REJECTED,
    });

    const delivery = await deliveryRepo.findById(seeded.deliveryId);
    expect(delivery?.status).toBe("BOOKED");
  });

  it("returns unknown outcome when provider times out", async () => {
    executeMock.mockRejectedValue(
      new ProviderAdapterError({
        providerCode: "MOCK",
        operation: "cancelBooking",
        category: "PROVIDER_TIMEOUT",
        safeMessage: "Provider timed out",
      }),
    );

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
        requestId: "req-cancel-timeout",
        reasonCode: "CUSTOMER_CHANGED_MIND",
        requestHash: "hash-timeout",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.CANCELLATION_UNKNOWN,
    });
  });

  it("blocks retry when cancellation is already in progress", async () => {
    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });
    const booking = await bookingRepo.findLatestByDeliveryId(seeded.deliveryId);

    await cancellationRepo.create({
      deliveryId: seeded.deliveryId,
      providerBookingId: booking!.id,
      providerId: booking!.providerId,
      reasonCode: "CUSTOMER_CHANGED_MIND",
      reasonMessage: null,
      status: "PROCESSING",
      correlationReference: `${seeded.deliveryReference}-CANCEL-1`,
      requestId: "req-in-progress",
    });

    await expect(
      service.cancel({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-cancel-in-progress",
        reasonCode: "CUSTOMER_CHANGED_MIND",
        requestHash: "hash-in-progress",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.CANCELLATION_IN_PROGRESS,
    });
  });

  it("returns cached response for repeated idempotency key", async () => {
    mockProviderCancelSuccess();

    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });
    const key = randomUUID();
    const requestHash = "hash-idem";

    const first = await service.cancel({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-cancel-idem-1",
      reasonCode: "CUSTOMER_CHANGED_MIND",
      idempotencyKey: key,
      requestHash,
    });

    const second = await service.cancel({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-cancel-idem-2",
      reasonCode: "CUSTOMER_CHANGED_MIND",
      idempotencyKey: key,
      requestHash,
    });

    expect(second.data).toEqual(first.data);
    expect(executeMock).toHaveBeenCalledOnce();
  });

  it("rejects idempotency key reused with different request hash", async () => {
    mockProviderCancelSuccess();

    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });
    const key = randomUUID();

    await service.cancel({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-cancel-idem-conflict-1",
      reasonCode: "CUSTOMER_CHANGED_MIND",
      idempotencyKey: key,
      requestHash: "hash-a",
    });

    await expect(
      service.cancel({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-cancel-idem-conflict-2",
        reasonCode: "WRONG_ADDRESS",
        idempotencyKey: key,
        requestHash: "hash-b",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.IDEMPOTENCY_CONFLICT,
    });
  });

  it("returns 404 when customer does not own the delivery", async () => {
    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
    });

    await expect(
      service.cancel({
        deliveryId: seeded.deliveryId,
        userId: otherCustomerId,
        role: "CUSTOMER",
        requestId: "req-cancel-other",
        reasonCode: "CUSTOMER_CHANGED_MIND",
        requestHash: "hash-other",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.DELIVERY_NOT_FOUND,
    });
  });

  it("returns latest cancellation details", async () => {
    mockProviderCancelSuccess();

    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });

    await service.cancel({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-cancel-get",
      reasonCode: "CUSTOMER_CHANGED_MIND",
      requestHash: "hash-get",
    });

    const result = await service.getCancellation({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
    });

    expect(result.data.delivery.status).toBe("CANCELLED");
    expect(result.data.cancellation.status).toBe("CANCELLED");
    expect(result.data.cancellation.reasonCode).toBe("CUSTOMER_CHANGED_MIND");
  });

  it("returns not found when no cancellation exists", async () => {
    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });

    await expect(
      service.getCancellation({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.CANCELLATION_NOT_FOUND,
    });
  });
});
