import { beforeEach, describe, expect, it } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { AppError } from "../src/core/errors/app-error.js";
import { DeliveryLifecycleService } from "../src/modules/delivery/delivery-lifecycle.service.js";
import { OtpService } from "../src/modules/otp/otp.service.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryOtpRepository } from "./helpers/in-memory-otp-repository.js";
import { seedBookedDelivery } from "./helpers/operational-test-helpers.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";

describe("OtpService", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let otpRepo: InMemoryOtpRepository;
  let bookingRepo: InMemoryBookingRepository;
  let orchestrationRepo: InMemoryOrchestrationRepository;
  let providerRepo: InMemoryProviderRepository;
  let service: OtpService;
  const customerId = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    deliveryRepo = new InMemoryDeliveryRepository();
    otpRepo = new InMemoryOtpRepository();
    bookingRepo = new InMemoryBookingRepository();
    orchestrationRepo = new InMemoryOrchestrationRepository();
    providerRepo = new InMemoryProviderRepository();
    service = new OtpService(
      deliveryRepo,
      otpRepo,
      new DeliveryLifecycleService(deliveryRepo),
    );
  });

  async function seedDriverAssigned() {
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
    return seeded;
  }

  it("generates pickup OTP and transitions to PICKUP_OTP_PENDING", async () => {
    const seeded = await seedDriverAssigned();
    const result = await service.generatePickupOtp({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-1",
    });

    expect(result.data.type).toBe("PICKUP");
    expect(result.data._testOtp).toMatch(/^\d{6}$/);
    const delivery = await deliveryRepo.findById(seeded.deliveryId);
    expect(delivery?.status).toBe("PICKUP_OTP_PENDING");
  });

  it("verifies pickup OTP and transitions to PICKED_UP", async () => {
    const seeded = await seedDriverAssigned();
    const generated = await service.generatePickupOtp({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-2",
    });

    const verified = await service.verifyPickupOtp({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      otp: generated.data._testOtp!,
      requestId: "req-3",
    });

    expect(verified.data.status).toBe("PICKED_UP");
  });

  it("rejects invalid pickup OTP", async () => {
    const seeded = await seedDriverAssigned();
    await service.generatePickupOtp({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-4",
    });

    await expect(
      service.verifyPickupOtp({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        otp: "000000",
        requestId: "req-5",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.OTP_INVALID,
    });
  });

  it("completes delivery OTP lifecycle to DELIVERED", async () => {
    const seeded = await seedDriverAssigned();
    const pickup = await service.generatePickupOtp({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-6",
    });
    await service.verifyPickupOtp({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      otp: pickup.data._testOtp!,
      requestId: "req-7",
    });
    await deliveryRepo.transitionStatus({
      deliveryId: seeded.deliveryId,
      expectedFromStatuses: ["PICKED_UP"],
      toStatus: "IN_TRANSIT",
      source: "TRACKING",
      reason: "test",
    });

    const deliveryOtp = await service.generateDeliveryOtp({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-8",
    });
    const result = await service.verifyDeliveryOtp({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      otp: deliveryOtp.data._testOtp!,
      requestId: "req-9",
    });

    expect(result.data.status).toBe("DELIVERED");
  });

  it("rejects pickup OTP generation when status is not eligible", async () => {
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
    await deliveryRepo.transitionStatus({
      deliveryId: seeded.deliveryId,
      expectedFromStatuses: ["PICKED_UP"],
      toStatus: "IN_TRANSIT",
      source: "TRACKING",
      reason: "test",
    });

    await expect(
      service.generatePickupOtp({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-10",
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});
