import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { AppError } from "../src/core/errors/app-error.js";
import { DeliveryLifecycleService } from "../src/modules/delivery/delivery-lifecycle.service.js";
import { OtpService } from "../src/modules/otp/otp.service.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryDriverRepository } from "./helpers/in-memory-driver-repository.js";
import { InMemoryOtpRepository } from "./helpers/in-memory-otp-repository.js";
import {
  getActiveOtp,
  seedCustomerUser,
  seedDriverAssignedDelivery,
  seedInTransitDelivery,
} from "./helpers/otp-test-helpers.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { createOtpTestSmsSender } from "./helpers/sms-test-helpers.js";

describe("OtpService SMS-only notifications", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let otpRepo: InMemoryOtpRepository;
  let bookingRepo: InMemoryBookingRepository;
  let orchestrationRepo: InMemoryOrchestrationRepository;
  let providerRepo: InMemoryProviderRepository;
  let authRepo: InMemoryAuthRepository;
  let driverRepo: InMemoryDriverRepository;
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
    sendPickupOtpSms = vi.fn(async () => undefined);
    sendDeliveryOtpSms = vi.fn(async () => undefined);
    isSmsEnabled = vi.fn(() => true);
  });

  function createService() {
    return new OtpService(
      deliveryRepo,
      otpRepo,
      new DeliveryLifecycleService(deliveryRepo),
      createOtpTestSmsSender({
        isEnabled: isSmsEnabled,
        sendPickupOtpSms,
        sendDeliveryOtpSms,
      }),
      driverRepo,
    );
  }

  it("sends pickup OTP SMS to the pickup contact phone", async () => {
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

    expect(sendPickupOtpSms).toHaveBeenCalledOnce();
    expect(sendPickupOtpSms).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientMobile: "919888877776",
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

  it("rejects pickup OTP generation when SMS is disabled", async () => {
    isSmsEnabled.mockReturnValue(false);
    const service = createService();
    const seeded = await seedDriverAssignedDelivery(repoBundle());

    await expect(
      service.generatePickupOtp({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-sms-disabled",
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.SMS_NOT_CONFIGURED });

    expect(sendPickupOtpSms).not.toHaveBeenCalled();
    expect(getActiveOtp(otpRepo, seeded.deliveryId, "PICKUP")).toBeUndefined();
  });

  it("returns SMS_DELIVERY_FAILED and rolls back the new OTP on clear SMS failure", async () => {
    sendPickupOtpSms.mockRejectedValue(
      new AppError("Unable to send pickup verification SMS at this time.", {
        statusCode: 503,
        code: ErrorCodes.SMS_DELIVERY_FAILED,
        cause: { smsOutcome: "FAILED" },
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

    expect((await deliveryRepo.findById(seeded.deliveryId))?.status).toBe(
      "DRIVER_ASSIGNED",
    );
    expect(getActiveOtp(otpRepo, seeded.deliveryId, "PICKUP")).toBeUndefined();
  });

  it("keeps the OTP active when SMS delivery outcome is UNKNOWN", async () => {
    sendPickupOtpSms.mockRejectedValue(
      new AppError("Unable to send pickup verification SMS at this time.", {
        statusCode: 503,
        code: ErrorCodes.SMS_DELIVERY_FAILED,
        cause: { smsOutcome: "UNKNOWN" },
      }),
    );
    const service = createService();
    const seeded = await seedDriverAssignedDelivery(repoBundle());

    await expect(
      service.generatePickupOtp({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-sms-unknown",
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.SMS_DELIVERY_FAILED });

    expect(getActiveOtp(otpRepo, seeded.deliveryId, "PICKUP")).toBeDefined();
  });

  it("keeps the OTP active for an unsupported runtime smsOutcome string", async () => {
    sendPickupOtpSms.mockRejectedValue(
      new AppError("Unable to send pickup verification SMS at this time.", {
        statusCode: 503,
        code: ErrorCodes.SMS_DELIVERY_FAILED,
        cause: { smsOutcome: "NOT_VALID" },
      }),
    );
    const service = createService();
    const seeded = await seedDriverAssignedDelivery(repoBundle());

    await expect(
      service.generatePickupOtp({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-bogus-outcome",
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.SMS_DELIVERY_FAILED });

    expect(getActiveOtp(otpRepo, seeded.deliveryId, "PICKUP")).toBeDefined();
  });

  it("keeps the OTP active when SMS delivery outcome is ambiguous (timeout)", async () => {
    sendPickupOtpSms.mockRejectedValue(
      new AppError("Unable to send pickup verification SMS at this time.", {
        statusCode: 503,
        code: ErrorCodes.SMS_DELIVERY_FAILED,
        cause: { smsOutcome: "TIMEOUT" },
      }),
    );
    const service = createService();
    const seeded = await seedDriverAssignedDelivery(repoBundle());

    await expect(
      service.generatePickupOtp({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-sms-timeout",
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.SMS_DELIVERY_FAILED });

    expect((await deliveryRepo.findById(seeded.deliveryId))?.status).toBe(
      "DRIVER_ASSIGNED",
    );
    expect(getActiveOtp(otpRepo, seeded.deliveryId, "PICKUP")).toBeDefined();
  });

  it("sends delivery OTP SMS to the drop contact phone", async () => {
    const service = createService();
    const seeded = await seedInTransitDelivery({
      service,
      ...repoBundle(),
    });

    sendPickupOtpSms.mockClear();

    await service.generateDeliveryOtp({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-sms-delivery",
    });

    expect(sendDeliveryOtpSms).toHaveBeenCalledOnce();
    expect(sendDeliveryOtpSms).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientMobile: "919811122233",
        templateVariables: expect.objectContaining({
          event_type: "DELIVERY",
        }),
      }),
    );
  });

  it("rejects pickup OTP when pickup contact phone is missing", async () => {
    const service = createService();
    const seeded = await seedDriverAssignedDelivery(repoBundle());
    const delivery = await deliveryRepo.findById(seeded.deliveryId);
    delivery!.pickup.contactPhoneNumber = "";

    await expect(
      service.generatePickupOtp({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-missing-pickup-phone",
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.OTP_NOT_ALLOWED });

    expect(sendPickupOtpSms).not.toHaveBeenCalled();
    expect(getActiveOtp(otpRepo, seeded.deliveryId, "PICKUP")).toBeUndefined();
  });

  it("preserves the SMS error when OTP cleanup consume fails", async () => {
    sendPickupOtpSms.mockRejectedValue(
      new AppError("Unable to send pickup verification SMS at this time.", {
        statusCode: 503,
        code: ErrorCodes.SMS_DELIVERY_FAILED,
        cause: { smsOutcome: "FAILED" },
      }),
    );
    vi.spyOn(otpRepo, "consume").mockRejectedValueOnce(new Error("consume failed"));
    const service = createService();
    const seeded = await seedDriverAssignedDelivery(repoBundle());

    await expect(
      service.generatePickupOtp({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-cleanup-fail",
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.SMS_DELIVERY_FAILED });
  });

  it("does not fall back to the customer account phone for pickup SMS", async () => {
    const service = createService();
    const seeded = await seedDriverAssignedDelivery(repoBundle());
    const delivery = await deliveryRepo.findById(seeded.deliveryId);
    delivery!.pickup.contactPhoneCountryCode = "+91";
    delivery!.pickup.contactPhoneNumber = "9111223344";

    await service.generatePickupOtp({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-pickup-contact-only",
    });

    expect(sendPickupOtpSms).toHaveBeenCalledWith(
      expect.objectContaining({ recipientMobile: "919111223344" }),
    );
  });
});
