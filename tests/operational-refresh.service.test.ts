import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryLifecycleService } from "../src/modules/delivery/delivery-lifecycle.service.js";
import { DriverService } from "../src/modules/driver/driver.service.js";
import { OperationalRefreshService } from "../src/modules/operations/operational-refresh.service.js";
import { ProviderAdapterError } from "../src/modules/provider/contracts/provider-error.js";
import { ProviderAdapterExecutor } from "../src/modules/provider/adapters/provider-adapter-executor.js";
import { TrackingService } from "../src/modules/tracking/tracking.service.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryDriverRepository } from "./helpers/in-memory-driver-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { InMemoryTrackingRepository } from "./helpers/in-memory-tracking-repository.js";
import { seedBookedDelivery } from "./helpers/operational-test-helpers.js";
import { phoneRequest } from "./helpers/phone-test-helpers.js";

describe("OperationalRefreshService", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let bookingRepo: InMemoryBookingRepository;
  let trackingRepo: InMemoryTrackingRepository;
  let driverRepo: InMemoryDriverRepository;
  let orchestrationRepo: InMemoryOrchestrationRepository;
  let providerRepo: InMemoryProviderRepository;
  let executeMock: ReturnType<typeof vi.fn>;
  let service: OperationalRefreshService;
  const customerId = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    deliveryRepo = new InMemoryDeliveryRepository();
    bookingRepo = new InMemoryBookingRepository();
    trackingRepo = new InMemoryTrackingRepository();
    driverRepo = new InMemoryDriverRepository();
    orchestrationRepo = new InMemoryOrchestrationRepository();
    providerRepo = new InMemoryProviderRepository();
    executeMock = vi.fn();

    const lifecycle = new DeliveryLifecycleService(deliveryRepo);
    const stubRefresh = {
      refreshFromProvider: vi.fn(),
    };
    const driverService = new DriverService(
      deliveryRepo,
      bookingRepo,
      driverRepo,
      lifecycle,
      stubRefresh as unknown as OperationalRefreshService,
    );
    const trackingService = new TrackingService(
      deliveryRepo,
      trackingRepo,
      lifecycle,
      stubRefresh as unknown as OperationalRefreshService,
    );

    service = new OperationalRefreshService(
      deliveryRepo,
      bookingRepo,
      { execute: executeMock } as unknown as ProviderAdapterExecutor,
      { driver: driverService, tracking: trackingService },
    );
  });

  function mockTracking(overrides?: Record<string, unknown>) {
    executeMock.mockResolvedValue({
      status: "UNKNOWN",
      latitude: 12.9716,
      longitude: 77.5946,
      accuracyMeters: 10,
      providerTimestamp: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      eta: null,
      trackingUrl: "https://mock.test/track/1",
      driver: null,
      providerEventId: "evt-unified-1",
      ...overrides,
    });
  }

  it("calls getTracking exactly once and persists driver and tracking", async () => {
    mockTracking({
      status: "DRIVER_ASSIGNED",
      latitude: null,
      longitude: null,
      driver: {
        providerDriverId: "D1",
        name: "Alex",
        phone: phoneRequest("+91", "9900000001"),
        photoUrl: null,
        providerRating: 4.5,
        vehicleType: "BIKE",
        vehicleNumber: "KA01AB1234",
        assignedAt: new Date().toISOString(),
      },
      providerEventId: "evt-unified-driver-track",
    });

    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });

    const result = await service.refreshFromProvider({
      deliveryId: seeded.deliveryId,
      requestId: "req-unified",
      source: "PROVIDER_POLL",
      failureMode: "preserve",
    });

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0]?.[0]?.operation).toBe("getTracking");
    expect(result.pollSucceeded).toBe(true);
    expect(driverRepo.assignments).toHaveLength(1);
    expect(trackingRepo.points).toHaveLength(1);
  });

  it("transitions BOOKED to DRIVER_ASSIGNED when provider courier is present", async () => {
    mockTracking({
      status: "DRIVER_ASSIGNED",
      driver: {
        providerDriverId: "D1",
        name: "Alex",
        phone: phoneRequest("+91", "9900000001"),
        photoUrl: null,
        providerRating: 4.5,
        vehicleType: "BIKE",
        vehicleNumber: "KA01AB1234",
        assignedAt: new Date().toISOString(),
      },
      providerEventId: "evt-driver-assign",
    });

    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });

    await service.refreshFromProvider({
      deliveryId: seeded.deliveryId,
      requestId: "req-driver",
      source: "PROVIDER_POLL",
      failureMode: "preserve",
    });

    const delivery = await deliveryRepo.findById(seeded.deliveryId);
    expect(delivery?.status).toBe("DRIVER_ASSIGNED");
  });

  it("transitions PICKED_UP to IN_TRANSIT from provider tracking", async () => {
    mockTracking({ status: "IN_TRANSIT", providerEventId: "evt-in-transit" });

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
      requestId: "req-transit",
      source: "PROVIDER_POLL",
      failureMode: "preserve",
    });

    const delivery = await deliveryRepo.findById(seeded.deliveryId);
    expect(delivery?.status).toBe("IN_TRANSIT");
  });

  it("does not transition to PICKED_UP or DELIVERED from provider tracking", async () => {
    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });

    mockTracking({
      status: "PICKED_UP",
      providerEventId: "evt-picked-up-blocked",
    });
    await service.refreshFromProvider({
      deliveryId: seeded.deliveryId,
      requestId: "req-no-pickup",
      source: "PROVIDER_POLL",
      failureMode: "preserve",
    });
    let delivery = await deliveryRepo.findById(seeded.deliveryId);
    expect(delivery?.status).toBe("BOOKED");

    await deliveryRepo.transitionStatus({
      deliveryId: seeded.deliveryId,
      expectedFromStatuses: ["BOOKED"],
      toStatus: "PICKED_UP",
      source: "OTP",
      reason: "test",
    });

    mockTracking({
      status: "DELIVERED",
      providerEventId: "evt-delivered-blocked",
    });
    await service.refreshFromProvider({
      deliveryId: seeded.deliveryId,
      requestId: "req-no-delivered",
      source: "PROVIDER_POLL",
      failureMode: "preserve",
    });
    delivery = await deliveryRepo.findById(seeded.deliveryId);
    expect(delivery?.status).toBe("PICKED_UP");
  });

  it("preserves existing state when provider fails in preserve mode", async () => {
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

    await driverRepo.upsertAssignment({
      deliveryId: seeded.deliveryId,
      providerBookingId: seeded.bookingId,
      providerId: seeded.providerId,
      providerDriverId: "DRV-1",
      driverName: "Alex",
      driverPhoneCountryCode: "+91",
      driverPhoneNumber: "9900000001",
      driverPhotoUrl: null,
      providerRating: 4.5,
      vehicleType: "BIKE",
      vehicleNumber: "KA01AB1234",
      assignedAt: new Date(),
      status: "ASSIGNED",
      source: "PROVIDER_POLL",
      providerStatus: "assigned",
    });

    trackingRepo.points.push({
      id: "point-1",
      deliveryId: seeded.deliveryId,
      providerBookingId: seeded.bookingId,
      providerId: seeded.providerId,
      providerEventId: "evt-existing",
      latitude: 12.9716,
      longitude: 77.5946,
      accuracyMeters: null,
      providerTimestamp: null,
      receivedAt: new Date(),
      eta: null,
      providerStatus: "IN_TRANSIT",
      normalizedStatus: "IN_TRANSIT",
      trackingUrl: null,
      source: "PROVIDER_POLL",
      metadata: null,
      createdAt: new Date(),
    });

    const result = await service.refreshFromProvider({
      deliveryId: seeded.deliveryId,
      requestId: "req-fail-preserve",
      source: "PROVIDER_POLL",
      failureMode: "preserve",
    });

    expect(result.pollSucceeded).toBe(false);
    expect(trackingRepo.points).toHaveLength(1);
    expect(driverRepo.assignments).toHaveLength(1);
    const delivery = await deliveryRepo.findById(seeded.deliveryId);
    expect(delivery?.status).toBe("PICKED_UP");
  });

  it("throws provider errors in throw mode", async () => {
    executeMock.mockRejectedValue(
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

    await expect(
      service.refreshFromProvider({
        deliveryId: seeded.deliveryId,
        requestId: "req-fail-throw",
        source: "ADMIN_TRACKING_REFRESH",
        failureMode: "throw",
      }),
    ).rejects.toMatchObject({
      category: "PROVIDER_SERVICE_UNAVAILABLE",
    });
  });
});
