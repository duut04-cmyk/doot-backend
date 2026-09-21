import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OTP_EXPIRY_SECONDS,
  OTP_GENERATION_COOLDOWN_SECONDS,
  OTP_MAX_ATTEMPTS,
} from "../src/config/env.js";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { AppError } from "../src/core/errors/app-error.js";
import { DeliveryLifecycleService } from "../src/modules/delivery/delivery-lifecycle.service.js";
import { GENERIC_OTP_ERROR } from "../src/modules/otp/otp.constants.js";
import { OtpService } from "../src/modules/otp/otp.service.js";
import { createNoopEmailSender } from "./helpers/email-test-helpers.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryOtpRepository } from "./helpers/in-memory-otp-repository.js";
import {
  backdateActiveOtpCreatedAt,
  expireActiveOtp,
  getActiveOtp,
  seedCustomerUser,
  seedDeliveryOtpPending,
  seedDriverAssignedDelivery,
  seedInTransitDelivery,
  seedPickupOtpPending,
} from "./helpers/otp-test-helpers.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";

describe("OtpService", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let otpRepo: InMemoryOtpRepository;
  let bookingRepo: InMemoryBookingRepository;
  let orchestrationRepo: InMemoryOrchestrationRepository;
  let providerRepo: InMemoryProviderRepository;
  let authRepo: InMemoryAuthRepository;
  let sendPickupOtpEmail: ReturnType<typeof vi.fn>;
  let sendDeliveryOtpEmail: ReturnType<typeof vi.fn>;
  let service: OtpService;
  const customerId = "11111111-1111-4111-8111-111111111111";
  const otherCustomerId = "22222222-2222-4222-8222-222222222222";

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
    seedCustomerUser(authRepo, { id: customerId });
    seedCustomerUser(authRepo, {
      id: otherCustomerId,
      email: "other@example.com",
      name: "Other Customer",
    });
    sendPickupOtpEmail = vi.fn(async () => undefined);
    sendDeliveryOtpEmail = vi.fn(async () => undefined);
    service = new OtpService(
      deliveryRepo,
      otpRepo,
      new DeliveryLifecycleService(deliveryRepo),
      authRepo,
      createNoopEmailSender({ sendPickupOtpEmail, sendDeliveryOtpEmail }),
    );
  });

  describe("happy path", () => {
    it("generates pickup OTP and transitions to PICKUP_OTP_PENDING", async () => {
      const seeded = await seedDriverAssignedDelivery(repoBundle());
      const result = await service.generatePickupOtp({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-1",
      });

      expect(result.data.type).toBe("PICKUP");
      expect(result.data._testOtp).toMatch(/^\d{6}$/);
      expect(sendPickupOtpEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "customer@example.com",
          recipientName: "Test Customer",
          deliveryReference: seeded.deliveryReference,
          otp: result.data._testOtp,
        }),
      );
      const delivery = await deliveryRepo.findById(seeded.deliveryId);
      expect(delivery?.status).toBe("PICKUP_OTP_PENDING");
    });

    it("verifies pickup OTP and transitions to PICKED_UP", async () => {
      const { seeded, generated } = await seedPickupOtpPending({
        service,
        ...repoBundle(),
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

    it("generates delivery OTP, emails customer, and transitions to DELIVERY_OTP_PENDING", async () => {
      const seeded = await seedInTransitDelivery({ service, ...repoBundle() });

      const result = await service.generateDeliveryOtp({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-delivery-email-3",
      });

      expect(result.data.type).toBe("DELIVERY");
      expect(result.data._testOtp).toMatch(/^\d{6}$/);
      expect(sendDeliveryOtpEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "customer@example.com",
          otp: result.data._testOtp,
        }),
      );
      const delivery = await deliveryRepo.findById(seeded.deliveryId);
      expect(delivery?.status).toBe("DELIVERY_OTP_PENDING");
    });

    it("completes delivery OTP lifecycle to DELIVERED", async () => {
      const { seeded, generated } = await seedDeliveryOtpPending({
        service,
        ...repoBundle(),
      });

      const result = await service.verifyDeliveryOtp({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        otp: generated.data._testOtp!,
        requestId: "req-9",
      });

      expect(result.data.status).toBe("DELIVERED");
    });
  });

  describe("invalid OTP", () => {
    it("rejects incorrect pickup OTP without changing status or revealing the code", async () => {
      const { seeded, generated } = await seedPickupOtpPending({
        service,
        ...repoBundle(),
      });

      await expect(
        service.verifyPickupOtp({
          deliveryId: seeded.deliveryId,
          userId: customerId,
          role: "CUSTOMER",
          otp: "000000",
          requestId: "req-invalid-pickup",
        }),
      ).rejects.toMatchObject({
        code: ErrorCodes.OTP_INVALID,
        message: GENERIC_OTP_ERROR,
      });

      const delivery = await deliveryRepo.findById(seeded.deliveryId);
      expect(delivery?.status).toBe("PICKUP_OTP_PENDING");
      const active = getActiveOtp(otpRepo, seeded.deliveryId, "PICKUP");
      expect(active?.attempts).toBe(1);
      expect(JSON.stringify(active)).not.toContain(generated.data._testOtp);
    });

    it("rejects incorrect delivery OTP without changing status", async () => {
      const { seeded } = await seedDeliveryOtpPending({ service, ...repoBundle() });

      await expect(
        service.verifyDeliveryOtp({
          deliveryId: seeded.deliveryId,
          userId: customerId,
          role: "CUSTOMER",
          otp: "000000",
          requestId: "req-invalid-delivery",
        }),
      ).rejects.toMatchObject({
        code: ErrorCodes.OTP_INVALID,
        message: GENERIC_OTP_ERROR,
      });

      const delivery = await deliveryRepo.findById(seeded.deliveryId);
      expect(delivery?.status).toBe("DELIVERY_OTP_PENDING");
      expect(getActiveOtp(otpRepo, seeded.deliveryId, "DELIVERY")?.attempts).toBe(1);
    });
  });

  describe("maximum attempts", () => {
    it("locks pickup OTP after max failed attempts and rejects a later correct code", async () => {
      const { seeded, generated } = await seedPickupOtpPending({
        service,
        ...repoBundle(),
      });

      for (let i = 0; i < OTP_MAX_ATTEMPTS - 1; i += 1) {
        await expect(
          service.verifyPickupOtp({
            deliveryId: seeded.deliveryId,
            userId: customerId,
            role: "CUSTOMER",
            otp: "000000",
            requestId: `req-lock-${i}`,
          }),
        ).rejects.toMatchObject({ code: ErrorCodes.OTP_INVALID });
      }

      await expect(
        service.verifyPickupOtp({
          deliveryId: seeded.deliveryId,
          userId: customerId,
          role: "CUSTOMER",
          otp: "000000",
          requestId: "req-lock-final",
        }),
      ).rejects.toMatchObject({ code: ErrorCodes.OTP_LOCKED });

      await expect(
        service.verifyPickupOtp({
          deliveryId: seeded.deliveryId,
          userId: customerId,
          role: "CUSTOMER",
          otp: generated.data._testOtp!,
          requestId: "req-lock-correct",
        }),
      ).rejects.toMatchObject({ code: ErrorCodes.OTP_LOCKED });

      expect((await deliveryRepo.findById(seeded.deliveryId))?.status).toBe(
        "PICKUP_OTP_PENDING",
      );
    });

    it("locks delivery OTP after max failed attempts", async () => {
      const { seeded } = await seedDeliveryOtpPending({ service, ...repoBundle() });

      for (let i = 0; i < OTP_MAX_ATTEMPTS; i += 1) {
        await expect(
          service.verifyDeliveryOtp({
            deliveryId: seeded.deliveryId,
            userId: customerId,
            role: "CUSTOMER",
            otp: "000000",
            requestId: `req-delivery-lock-${i}`,
          }),
        ).rejects.toMatchObject({
          code:
            i === OTP_MAX_ATTEMPTS - 1 ? ErrorCodes.OTP_LOCKED : ErrorCodes.OTP_INVALID,
        });
      }
    });
  });

  describe("OTP expiry", () => {
    it("rejects expired pickup OTP server-side", async () => {
      const { seeded, generated } = await seedPickupOtpPending({
        service,
        ...repoBundle(),
      });
      expireActiveOtp(otpRepo, seeded.deliveryId, "PICKUP");

      await expect(
        service.verifyPickupOtp({
          deliveryId: seeded.deliveryId,
          userId: customerId,
          role: "CUSTOMER",
          otp: generated.data._testOtp!,
          requestId: "req-expired-pickup",
        }),
      ).rejects.toMatchObject({
        code: ErrorCodes.OTP_EXPIRED,
        message: GENERIC_OTP_ERROR,
      });

      expect((await deliveryRepo.findById(seeded.deliveryId))?.status).toBe(
        "PICKUP_OTP_PENDING",
      );
    });

    it("rejects expired delivery OTP server-side", async () => {
      const { seeded, generated } = await seedDeliveryOtpPending({
        service,
        ...repoBundle(),
      });
      expireActiveOtp(otpRepo, seeded.deliveryId, "DELIVERY");

      await expect(
        service.verifyDeliveryOtp({
          deliveryId: seeded.deliveryId,
          userId: customerId,
          role: "CUSTOMER",
          otp: generated.data._testOtp!,
          requestId: "req-expired-delivery",
        }),
      ).rejects.toMatchObject({ code: ErrorCodes.OTP_EXPIRED });
    });
  });

  describe("OTP replay protection", () => {
    it("rejects replaying a successful pickup OTP verification", async () => {
      const { seeded, generated } = await seedPickupOtpPending({
        service,
        ...repoBundle(),
      });

      await service.verifyPickupOtp({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        otp: generated.data._testOtp!,
        requestId: "req-replay-1",
      });

      await expect(
        service.verifyPickupOtp({
          deliveryId: seeded.deliveryId,
          userId: customerId,
          role: "CUSTOMER",
          otp: generated.data._testOtp!,
          requestId: "req-replay-2",
        }),
      ).rejects.toMatchObject({ code: ErrorCodes.OTP_NOT_ALLOWED });

      expect((await deliveryRepo.findById(seeded.deliveryId))?.status).toBe(
        "PICKED_UP",
      );
    });

    it("rejects replaying a successful delivery OTP verification", async () => {
      const { seeded, generated } = await seedDeliveryOtpPending({
        service,
        ...repoBundle(),
      });

      await service.verifyDeliveryOtp({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        otp: generated.data._testOtp!,
        requestId: "req-replay-delivery-1",
      });

      await expect(
        service.verifyDeliveryOtp({
          deliveryId: seeded.deliveryId,
          userId: customerId,
          role: "CUSTOMER",
          otp: generated.data._testOtp!,
          requestId: "req-replay-delivery-2",
        }),
      ).rejects.toMatchObject({ code: ErrorCodes.OTP_NOT_ALLOWED });

      expect((await deliveryRepo.findById(seeded.deliveryId))?.status).toBe(
        "DELIVERED",
      );
    });

    it("consumes OTP only once under concurrent verification attempts", async () => {
      const { seeded, generated } = await seedPickupOtpPending({
        service,
        ...repoBundle(),
      });
      const code = generated.data._testOtp!;

      const results = await Promise.allSettled([
        service.verifyPickupOtp({
          deliveryId: seeded.deliveryId,
          userId: customerId,
          role: "CUSTOMER",
          otp: code,
          requestId: "req-race-1",
        }),
        service.verifyPickupOtp({
          deliveryId: seeded.deliveryId,
          userId: customerId,
          role: "CUSTOMER",
          otp: code,
          requestId: "req-race-2",
        }),
      ]);

      expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((item) => item.status === "rejected")).toHaveLength(1);
    });
  });

  describe("resend behavior", () => {
    it("enforces generation cooldown before issuing another pickup OTP", async () => {
      const seeded = await seedDriverAssignedDelivery(repoBundle());
      await service.generatePickupOtp({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-resend-1",
      });

      await expect(
        service.generatePickupOtp({
          deliveryId: seeded.deliveryId,
          userId: customerId,
          role: "CUSTOMER",
          requestId: "req-resend-2",
        }),
      ).rejects.toMatchObject({ code: ErrorCodes.OTP_GENERATION_COOLDOWN });
    });

    it("invalidates the previous pickup OTP when a new one is generated after cooldown", async () => {
      const { seeded, generated: first } = await seedPickupOtpPending({
        service,
        ...repoBundle(),
      });

      backdateActiveOtpCreatedAt(
        otpRepo,
        seeded.deliveryId,
        "PICKUP",
        (OTP_GENERATION_COOLDOWN_SECONDS + 1) * 1000,
      );

      const second = await service.generatePickupOtp({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-resend-3",
      });

      await expect(
        service.verifyPickupOtp({
          deliveryId: seeded.deliveryId,
          userId: customerId,
          role: "CUSTOMER",
          otp: first.data._testOtp!,
          requestId: "req-old-otp",
        }),
      ).rejects.toMatchObject({ code: ErrorCodes.OTP_INVALID });

      const verified = await service.verifyPickupOtp({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        otp: second.data._testOtp!,
        requestId: "req-new-otp",
      });
      expect(verified.data.status).toBe("PICKED_UP");
    });

    it("does not persist plaintext OTP in repository records", async () => {
      const { seeded, generated } = await seedPickupOtpPending({
        service,
        ...repoBundle(),
      });

      expect(JSON.stringify(otpRepo.otps)).not.toContain(generated.data._testOtp);
      expect(otpRepo.otps.some((row) => row.deliveryId === seeded.deliveryId)).toBe(
        true,
      );
    });
  });

  describe("email delivery failure", () => {
    it("does not advance delivery status when pickup OTP email fails", async () => {
      const seeded = await seedDriverAssignedDelivery(repoBundle());
      const failingService = new OtpService(
        deliveryRepo,
        otpRepo,
        new DeliveryLifecycleService(deliveryRepo),
        authRepo,
        createNoopEmailSender({
          sendPickupOtpEmail: vi.fn(async () => {
            throw new AppError(
              "Unable to send pickup verification email at this time",
              {
                statusCode: 503,
                code: ErrorCodes.EMAIL_DELIVERY_FAILED,
              },
            );
          }),
        }),
      );

      await expect(
        failingService.generatePickupOtp({
          deliveryId: seeded.deliveryId,
          userId: customerId,
          role: "CUSTOMER",
          requestId: "req-email-fail",
        }),
      ).rejects.toMatchObject({ code: ErrorCodes.EMAIL_DELIVERY_FAILED });

      expect((await deliveryRepo.findById(seeded.deliveryId))?.status).toBe(
        "DRIVER_ASSIGNED",
      );
    });
  });

  describe("authorization and ownership", () => {
    it("denies OTP verification for another customer's delivery", async () => {
      const { seeded } = await seedPickupOtpPending({ service, ...repoBundle() });

      await expect(
        service.verifyPickupOtp({
          deliveryId: seeded.deliveryId,
          userId: otherCustomerId,
          role: "CUSTOMER",
          otp: "123456",
          requestId: "req-other-customer",
        }),
      ).rejects.toMatchObject({ code: ErrorCodes.DELIVERY_NOT_FOUND });
    });

    it("allows admin to verify OTP for any delivery", async () => {
      const { seeded, generated } = await seedPickupOtpPending({
        service,
        ...repoBundle(),
      });

      const verified = await service.verifyPickupOtp({
        deliveryId: seeded.deliveryId,
        userId: "admin-user-id",
        role: "ADMIN",
        otp: generated.data._testOtp!,
        requestId: "req-admin-verify",
      });

      expect(verified.data.status).toBe("PICKED_UP");
    });
  });

  describe("delivery lifecycle safety", () => {
    it("rejects pickup OTP generation when status is not eligible", async () => {
      const seeded = await seedInTransitDelivery({ service, ...repoBundle() });

      await expect(
        service.generatePickupOtp({
          deliveryId: seeded.deliveryId,
          userId: customerId,
          role: "CUSTOMER",
          requestId: "req-10",
        }),
      ).rejects.toMatchObject({ code: ErrorCodes.OTP_NOT_ALLOWED });
    });

    it("rejects delivery OTP generation before IN_TRANSIT", async () => {
      const { seeded } = await seedPickupOtpPending({ service, ...repoBundle() });

      await expect(
        service.generateDeliveryOtp({
          deliveryId: seeded.deliveryId,
          userId: customerId,
          role: "CUSTOMER",
          requestId: "req-too-early-delivery-otp",
        }),
      ).rejects.toMatchObject({ code: ErrorCodes.OTP_NOT_ALLOWED });
    });

    it("rejects delivery OTP verification before DELIVERY_OTP_PENDING", async () => {
      const seeded = await seedInTransitDelivery({ service, ...repoBundle() });

      await expect(
        service.verifyDeliveryOtp({
          deliveryId: seeded.deliveryId,
          userId: customerId,
          role: "CUSTOMER",
          otp: "123456",
          requestId: "req-verify-too-early",
        }),
      ).rejects.toMatchObject({ code: ErrorCodes.OTP_NOT_ALLOWED });
    });

    it("rejects delivery OTP verification when already DELIVERED", async () => {
      const { seeded, generated } = await seedDeliveryOtpPending({
        service,
        ...repoBundle(),
      });
      await service.verifyDeliveryOtp({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        otp: generated.data._testOtp!,
        requestId: "req-delivered-once",
      });

      await expect(
        service.verifyDeliveryOtp({
          deliveryId: seeded.deliveryId,
          userId: customerId,
          role: "CUSTOMER",
          otp: generated.data._testOtp!,
          requestId: "req-delivered-twice",
        }),
      ).rejects.toMatchObject({ code: ErrorCodes.OTP_NOT_ALLOWED });
    });

    it("sets pickup OTP expiry based on configured OTP_EXPIRY_SECONDS", async () => {
      const { seeded } = await seedPickupOtpPending({ service, ...repoBundle() });
      const active = getActiveOtp(otpRepo, seeded.deliveryId, "PICKUP");
      expect(active).toBeDefined();
      const expectedExpiry = active!.createdAt.getTime() + OTP_EXPIRY_SECONDS * 1000;
      expect(Math.abs(active!.expiresAt.getTime() - expectedExpiry)).toBeLessThan(2000);
    });
  });
});
