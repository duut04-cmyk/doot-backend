import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderAdapterError } from "../src/modules/provider/contracts/provider-error.js";
import { TrackingService } from "../src/modules/tracking/tracking.service.js";
import { createOperationalServices } from "./helpers/operational-refresh-test-helpers.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { InMemoryTrackingRepository } from "./helpers/in-memory-tracking-repository.js";
import { seedBookedDelivery } from "./helpers/operational-test-helpers.js";

describe("Tracking failure resilience", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let bookingRepo: InMemoryBookingRepository;
  let trackingRepo: InMemoryTrackingRepository;
  let orchestrationRepo: InMemoryOrchestrationRepository;
  let providerRepo: InMemoryProviderRepository;
  let executeMock: ReturnType<typeof vi.fn>;
  let service: TrackingService;
  const customerId = "33333333-3333-4333-8333-333333333333";

  beforeEach(() => {
    deliveryRepo = new InMemoryDeliveryRepository();
    bookingRepo = new InMemoryBookingRepository();
    trackingRepo = new InMemoryTrackingRepository();
    orchestrationRepo = new InMemoryOrchestrationRepository();
    providerRepo = new InMemoryProviderRepository();
    executeMock = vi.fn();
    ({ trackingService: service } = createOperationalServices({
      deliveryRepo,
      bookingRepo,
      trackingRepo,
      executeMock,
    }));
  });

  it("does not persist tracking points when provider refresh times out", async () => {
    executeMock.mockRejectedValue(
      new ProviderAdapterError({
        providerCode: "MOCK",
        operation: "getTracking",
        category: "PROVIDER_TIMEOUT",
        safeMessage: "Tracking timed out.",
      }),
    );

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
      toStatus: "PICKED_UP",
      source: "OTP",
      reason: "test",
    });

    await expect(
      service.refreshFromProvider({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-track-timeout",
      }),
    ).rejects.toMatchObject({
      category: "PROVIDER_TIMEOUT",
    });

    expect(trackingRepo.points).toHaveLength(0);
    const delivery = await deliveryRepo.findById(seeded.deliveryId);
    expect(delivery?.status).toBe("PICKED_UP");
  });

  it("nulls invalid coordinates without corrupting prior tracking data", async () => {
    executeMock
      .mockResolvedValueOnce({
        status: "IN_TRANSIT",
        latitude: 12.9716,
        longitude: 77.5946,
        accuracyMeters: 10,
        providerTimestamp: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
        eta: null,
        trackingUrl: "https://mock.test/track/1",
        driver: null,
        providerEventId: "evt-valid-1",
      })
      .mockResolvedValueOnce({
        status: "IN_TRANSIT",
        latitude: 999,
        longitude: 999,
        accuracyMeters: null,
        providerTimestamp: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
        eta: null,
        trackingUrl: null,
        driver: null,
        providerEventId: "evt-invalid-1",
      });

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
      toStatus: "PICKED_UP",
      source: "OTP",
      reason: "test",
    });

    await service.refreshFromProvider({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-track-valid",
    });

    await service.refreshFromProvider({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-track-invalid",
    });

    expect(trackingRepo.points).toHaveLength(2);
    expect(trackingRepo.points[0]?.latitude).toBe(12.9716);
    expect(trackingRepo.points[1]?.latitude).toBeNull();
    expect(trackingRepo.points[1]?.longitude).toBeNull();
  });

  it("preserves existing tracking when refresh fails after a successful poll", async () => {
    executeMock
      .mockResolvedValueOnce({
        status: "IN_TRANSIT",
        latitude: 12.9716,
        longitude: 77.5946,
        accuracyMeters: null,
        providerTimestamp: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
        eta: null,
        trackingUrl: "https://mock.test/track/1",
        driver: null,
        providerEventId: "evt-persist-1",
      })
      .mockRejectedValueOnce(
        new ProviderAdapterError({
          providerCode: "MOCK",
          operation: "getTracking",
          category: "PROVIDER_SERVICE_UNAVAILABLE",
          safeMessage: "Unavailable.",
        }),
      );

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
      toStatus: "PICKED_UP",
      source: "OTP",
      reason: "test",
    });

    await service.refreshFromProvider({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-track-ok",
    });

    await expect(
      service.refreshFromProvider({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-track-fail",
      }),
    ).rejects.toMatchObject({
      category: "PROVIDER_SERVICE_UNAVAILABLE",
    });

    expect(trackingRepo.points).toHaveLength(1);
    const current = await service.getTracking({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
    });
    expect(current.data.tracking?.latitude).toBe(12.9716);
  });
});
