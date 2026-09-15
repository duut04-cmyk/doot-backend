import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryLifecycleService } from "../src/modules/delivery/delivery-lifecycle.service.js";
import { ProviderAdapterExecutor } from "../src/modules/provider/adapters/provider-adapter-executor.js";
import { TrackingService } from "../src/modules/tracking/tracking.service.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { InMemoryTrackingRepository } from "./helpers/in-memory-tracking-repository.js";
import { seedBookedDelivery } from "./helpers/operational-test-helpers.js";

describe("TrackingService", () => {
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
    service = new TrackingService(
      deliveryRepo,
      bookingRepo,
      trackingRepo,
      new DeliveryLifecycleService(deliveryRepo),
      { execute: executeMock } as unknown as ProviderAdapterExecutor,
    );
  });

  it("returns empty tracking when no points exist", async () => {
    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });

    const result = await service.getTracking({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
    });

    expect(result.data.tracking).toBeNull();
  });

  it("ingests provider poll tracking with coordinates", async () => {
    executeMock.mockResolvedValue({
      status: "IN_TRANSIT",
      latitude: 12.9716,
      longitude: 77.5946,
      accuracyMeters: 10,
      providerTimestamp: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      eta: null,
      trackingUrl: "https://mock.test/track/1",
      driver: null,
      providerEventId: "evt-track-1",
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

    const result = await service.refreshFromProvider({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-track",
    });

    expect(result.data.tracking?.latitude).toBe(12.9716);
    expect(trackingRepo.points).toHaveLength(1);
  });

  it("deduplicates webhook tracking by providerEventId", async () => {
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

    const event = {
      providerCode: "MOCK",
      providerEventId: "dup-event-1",
      eventType: "STATUS_UPDATE",
      providerReference: null,
      providerBookingId: seeded.providerOrderId,
      status: "IN_TRANSIT",
      eventTimestamp: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      driver: null,
      tracking: null,
      metadata: {},
    };

    await service.ingestFromWebhook({
      deliveryId: seeded.deliveryId,
      deliveryStatus: "PICKED_UP",
      providerBookingId: seeded.bookingId,
      providerId: seeded.providerId,
      event,
    });
    await service.ingestFromWebhook({
      deliveryId: seeded.deliveryId,
      deliveryStatus: "PICKED_UP",
      providerBookingId: seeded.bookingId,
      providerId: seeded.providerId,
      event,
    });

    expect(trackingRepo.points).toHaveLength(1);
  });
});
