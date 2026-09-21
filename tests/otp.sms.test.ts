import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { AppError } from "../src/core/errors/app-error.js";
import { DeliveryLifecycleService } from "../src/modules/delivery/delivery-lifecycle.service.js";
import { OtpService } from "../src/modules/otp/otp.service.js";
import { createNoopEmailSender } from "./helpers/email-test-helpers.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryDriverRepository } from "./helpers/in-memory-driver-repository.js";
import { InMemoryOtpRepository } from "./helpers/in-memory-otp-repository.js";
import {
  seedCustomerUser,
  seedDriverAssignedDelivery,
  seedInTransitDelivery,
} from "./helpers/otp-test-helpers.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { createNoopSmsSender } from "./helpers/sms-test-helpers.js";

describe("OtpService SMS dual-send", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let otpRepo: InMemoryOtpRepository;
  let bookingRepo: InMemoryBookingRepository;
  let orchestrationRepo: InMemoryOrchestrationRepository;
  let providerRepo: InMemoryProviderRepository;
  let authRepo: InMemoryAuthRepository;
  let driverRepo: InMemoryDriverRepository;
  let sendPickupOtpEmail: ReturnType<typeof vi.fn>;
  let sendDeliveryOtpEmail: ReturnType<typeof vi.fn>;
  let sendPickupOtpSms: ReturnType<typeof vi.fn>;
  let sendDeliveryOtpSms: ReturnType<typeof vi.fn>;
  let isSmsEnabled: ReturnType<typeof vi.fn>;
  const customerId = "11111111-1111-4111-8111-111111111111";

  const repoBundle = () => ({
    deliveryRepo,
    orchestrationRepo,
    providerRepo,
    bookingRepo,
    customerId,
  });

  beforeEach(() => {
    deliveryRepo = new InMemoryDeliveryRepository();
    otpRepo = new InMemoryOtpRepository();
    bookingRepo = new InMemoryBookingRepository();
    orchestrationRepo = new InMemoryOrchestrationRepository();
    providerRepo = new InMemoryProviderRepository();
    authRepo = new InMemoryAuthRepository();
    driverRepo = new InMemoryDriverRepository();
    seedCustomerUser(authRepo, { id: customerId });
    sendPickupOtpEmail = vi.fn(async () => undefined);
    sendDeliveryOtpEmail = vi.fn(async () => undefined);
    sendPickupOtpSms = vi.fn(async () => undefined);
    sendDeliveryOtpSms = vi.fn(async () => undefined);
    isSmsEnabled = vi.fn(() => true);
  });

  function createService() {
    return new OtpService(
      deliveryRepo,
      otpRepo,
      new DeliveryLifecycleService(deliveryRepo),
      authRepo,
      createNoopEmailSender({ sendPickupOtpEmail, sendDeliveryOtpEmail }),
      createNoopSmsSender({
        isEnabled: isSmsEnabled,
        canSendToCustomer: () => true,
        sendPickupOtpSms,
        sendDeliveryOtpSms,
      }),
      driverRepo,
    );
  }

  it("dual-sends pickup OTP via email and SMS when SMS is enabled", async () => {
    const service = createService();
    const seeded = await seedDriverAssignedDelivery(repoBundle());
    await driverRepo.upsertAssignment({
      deliveryId: seeded.deliveryId,
      providerBookingId: "booking-1",
      providerId: "provider-1",
      providerDriverId: "driver-1",
      driverName: "Aman Singh",
      driverPhoneCountryCode: "+91",
      driverPhoneNumber: "9123456789",
      driverPhotoUrl: null,
      providerRating: 4.8,
      vehicleType: "BIKE",
      vehicleNumber: "PB10AB1234",
      assignedAt: new Date(),
      status: "ASSIGNED",
      source: "WEBHOOK",
      providerStatus: "assigned",
    });

    const result = await service.generatePickupOtp({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-sms-pickup",
    });

    expect(sendPickupOtpEmail).toHaveBeenCalledOnce();
    expect(sendPickupOtpSms).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientMobile: "919876543210",
        deliveryReference: seeded.deliveryReference,
        otp: result.data._testOtp,
        templateVariables: expect.objectContaining({
          driver_name: "Aman Singh",
          vehicle_type: "BIKE",
          vehicle_number: "PB10AB1234",
          driver_phone_masked: "****6789",
          event_type: "PICKUP",
        }),
      }),
    );
  });

  it("keeps email-only behavior when SMS is disabled", async () => {
    isSmsEnabled.mockReturnValue(false);
    const service = createService();
    const seeded = await seedDriverAssignedDelivery(repoBundle());

    await service.generatePickupOtp({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-email-only",
    });

    expect(sendPickupOtpEmail).toHaveBeenCalledOnce();
    expect(sendPickupOtpSms).not.toHaveBeenCalled();
  });

  it("returns SMS_DELIVERY_FAILED when SMS fails after email succeeds", async () => {
    sendPickupOtpSms.mockRejectedValue(
      new AppError("Unable to send pickup verification SMS at this time.", {
        statusCode: 503,
        code: ErrorCodes.SMS_DELIVERY_FAILED,
      }),
    );
    const service = createService();
    const seeded = await seedDriverAssignedDelivery(repoBundle());

    await expect(
      service.generatePickupOtp({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-sms-fail",
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.SMS_DELIVERY_FAILED });

    expect(sendPickupOtpEmail).toHaveBeenCalledOnce();
    expect((await deliveryRepo.findById(seeded.deliveryId))?.status).toBe(
      "DRIVER_ASSIGNED",
    );
  });

  it("uses the delivery template for delivery OTP SMS", async () => {
    const service = createService();
    const seeded = await seedInTransitDelivery({
      service,
      ...repoBundle(),
    });

    sendPickupOtpEmail.mockClear();
    sendPickupOtpSms.mockClear();

    await service.generateDeliveryOtp({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-sms-delivery",
    });

    expect(sendDeliveryOtpEmail).toHaveBeenCalledOnce();
    expect(sendDeliveryOtpSms).toHaveBeenCalledWith(
      expect.objectContaining({
        templateVariables: expect.objectContaining({
          event_type: "DELIVERY",
        }),
      }),
    );
  });
});
