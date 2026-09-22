import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { createAuthenticateMiddleware } from "../src/core/middleware/authenticate.js";
import { errorHandlerMiddleware } from "../src/core/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/core/middleware/request-id.js";
import { CancellationService } from "../src/modules/cancellation/cancellation.service.js";
import { DeliveryLifecycleService } from "../src/modules/delivery/delivery-lifecycle.service.js";
import { createAdminOperationalRouter } from "../src/modules/operations/operational.routes.js";
import { OtpService } from "../src/modules/otp/otp.service.js";
import { initializeProviderAdapters } from "../src/modules/provider/adapters/bootstrap.js";
import { ProviderAdapterExecutor } from "../src/modules/provider/adapters/provider-adapter-executor.js";
import { ProviderAdapterError } from "../src/modules/provider/contracts/provider-error.js";
import { createOperationalServices } from "./helpers/operational-refresh-test-helpers.js";
import { storedDriverPhone } from "./helpers/phone-test-helpers.js";
import { TrackingService } from "../src/modules/tracking/tracking.service.js";
import { generateAccessToken } from "../src/modules/auth/auth.crypto.js";
import { createNoopEmailSender } from "./helpers/email-test-helpers.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";
import { seedCustomerUser } from "./helpers/otp-test-helpers.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryCancellationRepository } from "./helpers/in-memory-cancellation-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryDriverRepository } from "./helpers/in-memory-driver-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryOtpRepository } from "./helpers/in-memory-otp-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { InMemoryTrackingRepository } from "./helpers/in-memory-tracking-repository.js";
import { seedBookedDelivery } from "./helpers/operational-test-helpers.js";

describe("Phase 7 audit fixes", () => {
  const customerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let deliveryRepo: InMemoryDeliveryRepository;
  let bookingRepo: InMemoryBookingRepository;
  let driverRepo: InMemoryDriverRepository;
  let trackingRepo: InMemoryTrackingRepository;
  let cancellationRepo: InMemoryCancellationRepository;
  let orchestrationRepo: InMemoryOrchestrationRepository;
  let providerRepo: InMemoryProviderRepository;
  let authRepo: InMemoryAuthRepository;

  beforeEach(() => {
    initializeProviderAdapters();
    deliveryRepo = new InMemoryDeliveryRepository();
    bookingRepo = new InMemoryBookingRepository();
    driverRepo = new InMemoryDriverRepository();
    trackingRepo = new InMemoryTrackingRepository();
    cancellationRepo = new InMemoryCancellationRepository();
    orchestrationRepo = new InMemoryOrchestrationRepository();
    providerRepo = new InMemoryProviderRepository();
    authRepo = new InMemoryAuthRepository();
    seedCustomerUser(authRepo, { id: customerId });
  });

  function createOtpService(otpRepo: InMemoryOtpRepository) {
    return new OtpService(
      deliveryRepo,
      otpRepo,
      new DeliveryLifecycleService(deliveryRepo),
      authRepo,
      createNoopEmailSender(),
    );
  }

  it("does not advance to PICKED_UP from tracking while pickup OTP is pending", async () => {
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

    const tracking = new TrackingService(
      deliveryRepo,
      trackingRepo,
      new DeliveryLifecycleService(deliveryRepo),
    );

    await tracking.ingestFromWebhook({
      deliveryId: seeded.deliveryId,
      deliveryStatus: "PICKUP_OTP_PENDING",
      providerBookingId: seeded.bookingId,
      providerId: seeded.providerId,
      event: {
        providerCode: "MOCK",
        providerEventId: "evt-picked-up-bypass",
        eventType: "STATUS_UPDATE",
        providerReference: null,
        providerBookingId: seeded.providerOrderId,
        status: "picked_up",
        eventTimestamp: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
        driver: null,
        tracking: null,
        metadata: {},
      },
    });

    const delivery = await deliveryRepo.findById(seeded.deliveryId);
    expect(delivery?.status).toBe("PICKUP_OTP_PENDING");
  });

  it("preserves assigned driver snapshot when provider refresh fails", async () => {
    const executeMock = vi.fn().mockRejectedValue(new Error("provider down"));
    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });

    await driverRepo.upsertAssignment({
      deliveryId: seeded.deliveryId,
      providerBookingId: seeded.bookingId,
      providerId: seeded.providerId,
      providerDriverId: "DRV-1",
      driverName: "Alex",
      ...storedDriverPhone("+91", "9900000001"),
      driverPhotoUrl: null,
      providerRating: 4.5,
      vehicleType: "BIKE",
      vehicleNumber: "KA01AB1234",
      assignedAt: new Date(),
      status: "ASSIGNED",
      source: "PROVIDER_POLL",
      providerStatus: "assigned",
    });

    const { driverService: service } = createOperationalServices({
      deliveryRepo,
      bookingRepo,
      driverRepo,
      executeMock,
    });

    const result = await service.refreshFromProvider({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-driver-preserve",
    });

    expect(result.data.known).toBe(true);
    expect(result.data.driver?.name).toBe("Alex");
    const assignment = await driverRepo.findActiveByDeliveryId(seeded.deliveryId);
    expect(assignment?.driverName).toBe("Alex");
  });

  it("allows pickup OTP generation from BOOKED and transitions to PICKUP_OTP_PENDING", async () => {
    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });

    const otp = createOtpService(new InMemoryOtpRepository());

    await otp.generatePickupOtp({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-booked-pickup-otp",
    });

    const delivery = await deliveryRepo.findById(seeded.deliveryId);
    expect(delivery?.status).toBe("PICKUP_OTP_PENDING");
  });

  it("blocks cancellation retry when latest cancellation outcome is UNKNOWN", async () => {
    const executeMock = vi.fn().mockRejectedValue(
      new ProviderAdapterError({
        providerCode: "MOCK",
        operation: "cancelBooking",
        category: "PROVIDER_TIMEOUT",
        safeMessage: "timeout",
        retryable: true,
      }),
    );
    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });

    const service = new CancellationService(
      deliveryRepo,
      bookingRepo,
      providerRepo,
      cancellationRepo,
      new DeliveryLifecycleService(deliveryRepo),
      { execute: executeMock } as unknown as ProviderAdapterExecutor,
    );

    await expect(
      service.cancel({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-cancel-unknown-1",
        reasonCode: "CUSTOMER_CHANGED_MIND",
        requestHash: "hash-1",
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.CANCELLATION_UNKNOWN });

    await expect(
      service.cancel({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-cancel-unknown-2",
        reasonCode: "CUSTOMER_CHANGED_MIND",
        requestHash: "hash-2",
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.CANCELLATION_UNKNOWN });
  });

  it("consumes OTP only once under concurrent verification attempts", async () => {
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

    const otpRepo = new InMemoryOtpRepository();
    const otp = createOtpService(otpRepo);

    const generated = await otp.generatePickupOtp({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-otp-race-gen",
    });

    const code = generated.data._testOtp!;
    const results = await Promise.allSettled([
      otp.verifyPickupOtp({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        otp: code,
        requestId: "req-otp-race-1",
      }),
      otp.verifyPickupOtp({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        otp: code,
        requestId: "req-otp-race-2",
      }),
    ]);

    const fulfilled = results.filter((item) => item.status === "fulfilled");
    const rejected = results.filter((item) => item.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it("denies admin operational routes to non-admin users", async () => {
    const customer = await authRepo.createUser({
      name: "Customer",
      email: "audit-customer@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    customer.role = "CUSTOMER";
    const token = generateAccessToken(customer.id);

    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use(createAuthenticateMiddleware(authRepo));
    app.use(
      "/api/v1/admin/deliveries",
      createAdminOperationalRouter({
        authenticateMiddleware: createAuthenticateMiddleware(authRepo),
      }),
    );
    app.use(errorHandlerMiddleware);

    const res = await request(app)
      .post(
        `/api/v1/admin/deliveries/00000000-0000-4000-8000-000000000001/driver/refresh`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("allows admin operational routes for admin users", async () => {
    const admin = await authRepo.createUser({
      name: "Admin",
      email: "audit-admin@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    admin.role = "ADMIN";
    const token = generateAccessToken(admin.id);

    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use(
      "/api/v1/admin/deliveries",
      createAdminOperationalRouter({
        authenticateMiddleware: createAuthenticateMiddleware(authRepo),
      }),
    );
    app.use(errorHandlerMiddleware);

    const res = await request(app)
      .post(
        `/api/v1/admin/deliveries/00000000-0000-4000-8000-000000000001/driver/refresh`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).not.toBe(403);
  });
});
