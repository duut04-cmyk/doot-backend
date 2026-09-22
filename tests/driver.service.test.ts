import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { DriverService } from "../src/modules/driver/driver.service.js";
import { createOperationalServices } from "./helpers/operational-refresh-test-helpers.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryDriverRepository } from "./helpers/in-memory-driver-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { seedBookedDelivery } from "./helpers/operational-test-helpers.js";
import { phoneRequest } from "./helpers/phone-test-helpers.js";

describe("DriverService", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let bookingRepo: InMemoryBookingRepository;
  let driverRepo: InMemoryDriverRepository;
  let orchestrationRepo: InMemoryOrchestrationRepository;
  let providerRepo: InMemoryProviderRepository;
  let executeMock: ReturnType<typeof vi.fn>;
  let service: DriverService;
  const customerId = "22222222-2222-4222-8222-222222222222";

  beforeEach(() => {
    deliveryRepo = new InMemoryDeliveryRepository();
    bookingRepo = new InMemoryBookingRepository();
    driverRepo = new InMemoryDriverRepository();
    orchestrationRepo = new InMemoryOrchestrationRepository();
    providerRepo = new InMemoryProviderRepository();
    executeMock = vi.fn();
    ({ driverService: service } = createOperationalServices({
      deliveryRepo,
      bookingRepo,
      driverRepo,
      executeMock,
    }));
  });

  it("returns unknown driver when no assignment exists", async () => {
    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });

    const result = await service.getDriver({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
    });

    expect(result.data.known).toBe(false);
  });

  it("refreshes driver from provider and transitions to DRIVER_ASSIGNED", async () => {
    executeMock.mockResolvedValue({
      status: "DRIVER_ASSIGNED",
      latitude: null,
      longitude: null,
      accuracyMeters: null,
      providerTimestamp: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      eta: null,
      trackingUrl: null,
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
      providerEventId: "evt-1",
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
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-driver",
    });

    expect(result.data.known).toBe(true);
    expect(result.data.assigned).toBe(true);
    expect(result.data.driver?.name).toBe("Alex");
    const delivery = await deliveryRepo.findById(seeded.deliveryId);
    expect(delivery?.status).toBe("DRIVER_ASSIGNED");
  });

  it("simulates provider driver assignment from BOOKED and transitions to DRIVER_ASSIGNED", async () => {
    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });

    const result = await service.simulateProviderAssignment({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "ADMIN",
      driver: {
        providerDriverId: "MOCK-DRIVER-001",
        name: "Aman Singh",
        phone: phoneRequest("+91", "9876543210"),
        photoUrl: null,
        providerRating: 4.8,
        vehicleType: "BIKE",
        vehicleNumber: "PB10AB1234",
        assignedAt: new Date().toISOString(),
      },
    });

    expect(result.data.known).toBe(true);
    expect(result.data.assigned).toBe(true);
    expect(result.data.driver?.name).toBe("Aman Singh");
    const delivery = await deliveryRepo.findById(seeded.deliveryId);
    expect(delivery?.status).toBe("DRIVER_ASSIGNED");
    const assignment = await driverRepo.findActiveByDeliveryId(seeded.deliveryId);
    expect(assignment?.source).toBe("SYSTEM");
    expect(assignment?.providerDriverId).toBe("MOCK-DRIVER-001");
  });

  it("rejects driver simulation for invalid delivery state", async () => {
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

    await expect(
      service.simulateProviderAssignment({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "ADMIN",
        driver: {
          providerDriverId: "MOCK-DRIVER-001",
          name: "Aman Singh",
          phone: phoneRequest("+91", "9876543210"),
          photoUrl: null,
          providerRating: 4.8,
          vehicleType: "BIKE",
          vehicleNumber: "PB10AB1234",
          assignedAt: new Date().toISOString(),
        },
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: ErrorCodes.DELIVERY_INVALID_TRANSITION,
    });
  });

  it("repeated driver simulation updates assignment without duplicates", async () => {
    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });

    const driverPayload = {
      providerDriverId: "MOCK-DRIVER-001",
      name: "Aman Singh",
      phone: phoneRequest("+91", "9876543210"),
      photoUrl: null,
      providerRating: 4.8,
      vehicleType: "BIKE" as const,
      vehicleNumber: "PB10AB1234",
      assignedAt: new Date().toISOString(),
    };

    await service.simulateProviderAssignment({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "ADMIN",
      driver: driverPayload,
    });

    await service.simulateProviderAssignment({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "ADMIN",
      driver: {
        ...driverPayload,
        name: "Aman Singh Updated",
      },
    });

    const assigned = driverRepo.assignments.filter(
      (item) => item.deliveryId === seeded.deliveryId && item.status === "ASSIGNED",
    );
    expect(assigned).toHaveLength(1);
    expect(assigned[0]?.driverName).toBe("Aman Singh Updated");
  });
});
