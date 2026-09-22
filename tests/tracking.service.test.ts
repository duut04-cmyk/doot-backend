import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/core/errors/app-error.js";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { TrackingService } from "../src/modules/tracking/tracking.service.js";
import { createOperationalServices } from "./helpers/operational-refresh-test-helpers.js";
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
    ({ trackingService: service } = createOperationalServices({
      deliveryRepo,
      bookingRepo,
      trackingRepo,
      executeMock,
    }));
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

  it("rejects refresh when provider lacks tracking capabilities", async () => {
    executeMock.mockRejectedValue(
      new AppError(
        "Provider does not support required capabilities: LIVE_TRACKING, TRACKING_URL.",
        {
          statusCode: 422,
          code: ErrorCodes.PROVIDER_UNSUPPORTED_OPERATION,
        },
      ),
    );

    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });

    await expect(
      service.refreshFromProvider({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "ADMIN",
        requestId: "req-capability-gate",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.PROVIDER_UNSUPPORTED_OPERATION,
    });
    expect(trackingRepo.points).toHaveLength(0);
  });

  it("deduplicates repeated provider poll tracking with the same providerEventId", async () => {
    executeMock.mockResolvedValue({
      status: "IN_TRANSIT",
      latitude: null,
      longitude: null,
      accuracyMeters: null,
      providerTimestamp: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      eta: null,
      trackingUrl: "https://mock.test/track/1",
      driver: null,
      providerEventId: "poll-event-1",
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
      role: "ADMIN",
      requestId: "req-poll-1",
    });
    await service.refreshFromProvider({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "ADMIN",
      requestId: "req-poll-2",
    });

    expect(trackingRepo.points).toHaveLength(1);
  });

  it("denies tracking access to another customer delivery", async () => {
    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });

    await expect(
      service.getTracking({
        deliveryId: seeded.deliveryId,
        userId: "99999999-9999-4999-8999-999999999999",
        role: "CUSTOMER",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.DELIVERY_NOT_FOUND,
    });
  });
});
