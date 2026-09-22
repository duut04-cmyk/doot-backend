import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthenticateMiddleware } from "../src/core/middleware/authenticate.js";
import { errorHandlerMiddleware } from "../src/core/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/core/middleware/request-id.js";
import { CancellationController } from "../src/modules/cancellation/cancellation.controller.js";
import { CancellationService } from "../src/modules/cancellation/cancellation.service.js";
import { DeliveryLifecycleService } from "../src/modules/delivery/delivery-lifecycle.service.js";
import { DriverController } from "../src/modules/driver/driver.controller.js";
import { createOperationalRouter } from "../src/modules/operations/operational.routes.js";
import { OtpController } from "../src/modules/otp/otp.controller.js";
import { OtpService } from "../src/modules/otp/otp.service.js";
import { initializeProviderAdapters } from "../src/modules/provider/adapters/bootstrap.js";
import { ProviderAdapterExecutor } from "../src/modules/provider/adapters/provider-adapter-executor.js";
import { TrackingController } from "../src/modules/tracking/tracking.controller.js";
import { createOperationalServices } from "./helpers/operational-refresh-test-helpers.js";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { GENERIC_OTP_ERROR } from "../src/modules/otp/otp.constants.js";
import { generateAccessToken } from "../src/modules/auth/auth.crypto.js";
import { createNoopEmailSender } from "./helpers/email-test-helpers.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryCancellationRepository } from "./helpers/in-memory-cancellation-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryDriverRepository } from "./helpers/in-memory-driver-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryOtpRepository } from "./helpers/in-memory-otp-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { InMemoryTrackingRepository } from "./helpers/in-memory-tracking-repository.js";
import { seedBookedDelivery } from "./helpers/operational-test-helpers.js";

describe("Operational HTTP", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let bookingRepo: InMemoryBookingRepository;
  let driverRepo: InMemoryDriverRepository;
  let otpRepo: InMemoryOtpRepository;
  let trackingRepo: InMemoryTrackingRepository;
  let cancellationRepo: InMemoryCancellationRepository;
  let orchestrationRepo: InMemoryOrchestrationRepository;
  let providerRepo: InMemoryProviderRepository;
  let authRepo: InMemoryAuthRepository;
  let executeMock: ReturnType<typeof vi.fn>;
  let customerId: string;
  let token: string;

  beforeEach(async () => {
    initializeProviderAdapters();
    deliveryRepo = new InMemoryDeliveryRepository();
    bookingRepo = new InMemoryBookingRepository();
    driverRepo = new InMemoryDriverRepository();
    otpRepo = new InMemoryOtpRepository();
    trackingRepo = new InMemoryTrackingRepository();
    cancellationRepo = new InMemoryCancellationRepository();
    orchestrationRepo = new InMemoryOrchestrationRepository();
    providerRepo = new InMemoryProviderRepository();
    authRepo = new InMemoryAuthRepository();
    executeMock = vi.fn();

    const customer = await authRepo.createUser({
      name: "Customer",
      email: "ops@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    customer.role = "CUSTOMER";
    customerId = customer.id;
    token = generateAccessToken(customerId);
  });

  function buildApp() {
    const lifecycle = new DeliveryLifecycleService(deliveryRepo);
    const executor = {
      execute: executeMock,
    } as unknown as ProviderAdapterExecutor;
    const { driverService, trackingService } = createOperationalServices({
      deliveryRepo,
      bookingRepo,
      driverRepo,
      trackingRepo,
      executeMock,
    });

    const driverController = new DriverController(driverService);
    const otpController = new OtpController(
      new OtpService(
        deliveryRepo,
        otpRepo,
        lifecycle,
        authRepo,
        createNoopEmailSender(),
      ),
    );
    const trackingController = new TrackingController(trackingService);
    const cancellationController = new CancellationController(
      new CancellationService(
        deliveryRepo,
        bookingRepo,
        providerRepo,
        cancellationRepo,
        lifecycle,
        executor,
      ),
    );

    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use(createAuthenticateMiddleware(authRepo));
    app.use(
      "/api/v1/deliveries",
      createOperationalRouter({
        driverController,
        otpController,
        trackingController,
        cancellationController,
        authenticateMiddleware: createAuthenticateMiddleware(authRepo),
      }),
    );
    app.use(errorHandlerMiddleware);
    return app;
  }

  it("returns 401 without auth on driver endpoint", async () => {
    const app = buildApp();
    const res = await request(app).get(
      "/api/v1/deliveries/00000000-0000-4000-8000-000000000001/driver",
    );
    expect(res.status).toBe(401);
  });

  it("returns unknown driver before provider assignment", async () => {
    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });

    const app = buildApp();
    const res = await request(app)
      .get(`/api/v1/deliveries/${seeded.deliveryId}/driver`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.known).toBe(false);
  });

  it("returns 401 without auth on pickup OTP verify endpoint", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/v1/deliveries/00000000-0000-4000-8000-000000000001/pickup/verify-otp")
      .send({ otp: "123456" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(ErrorCodes.UNAUTHORIZED);
  });

  it("returns 400 for invalid OTP format over HTTP", async () => {
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

    const app = buildApp();
    await request(app)
      .post(`/api/v1/deliveries/${seeded.deliveryId}/pickup-otp`)
      .set("Authorization", `Bearer ${token}`);

    const res = await request(app)
      .post(`/api/v1/deliveries/${seeded.deliveryId}/pickup/verify-otp`)
      .set("Authorization", `Bearer ${token}`)
      .send({ otp: "12345" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it("returns 422 for incorrect pickup OTP without revealing the expected code", async () => {
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

    const app = buildApp();
    const generated = await request(app)
      .post(`/api/v1/deliveries/${seeded.deliveryId}/pickup-otp`)
      .set("Authorization", `Bearer ${token}`);

    const res = await request(app)
      .post(`/api/v1/deliveries/${seeded.deliveryId}/pickup/verify-otp`)
      .set("Authorization", `Bearer ${token}`)
      .send({ otp: "000000" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe(ErrorCodes.OTP_INVALID);
    expect(res.body.error.message).toBe(GENERIC_OTP_ERROR);
    expect(JSON.stringify(res.body)).not.toContain(generated.body.data._testOtp);
  });

  it("returns 404 when another customer accesses OTP endpoints", async () => {
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

    const other = await authRepo.createUser({
      name: "Other",
      email: "other-http@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    other.role = "CUSTOMER";
    const otherToken = generateAccessToken(other.id);

    const app = buildApp();
    const res = await request(app)
      .post(`/api/v1/deliveries/${seeded.deliveryId}/pickup-otp`)
      .set("Authorization", `Bearer ${otherToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(ErrorCodes.DELIVERY_NOT_FOUND);
  });

  it("returns 403 for suspended users on OTP endpoints", async () => {
    const suspended = await authRepo.createUser({
      name: "Suspended",
      email: "suspended@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    suspended.role = "CUSTOMER";
    suspended.status = "SUSPENDED";
    const suspendedToken = generateAccessToken(suspended.id);

    const app = buildApp();
    const res = await request(app)
      .post("/api/v1/deliveries/00000000-0000-4000-8000-000000000001/pickup-otp")
      .set("Authorization", `Bearer ${suspendedToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(ErrorCodes.ACCOUNT_SUSPENDED);
  });

  it("generates and verifies pickup OTP over HTTP", async () => {
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

    const app = buildApp();
    const generated = await request(app)
      .post(`/api/v1/deliveries/${seeded.deliveryId}/pickup-otp`)
      .set("Authorization", `Bearer ${token}`);

    expect(generated.status).toBe(200);
    expect(generated.body.data._testOtp).toMatch(/^\d{6}$/);

    const verified = await request(app)
      .post(`/api/v1/deliveries/${seeded.deliveryId}/pickup/verify-otp`)
      .set("Authorization", `Bearer ${token}`)
      .send({ otp: generated.body.data._testOtp });

    expect(verified.status).toBe(200);
    expect(verified.body.data.status).toBe("PICKED_UP");
  });

  it("cancels booked delivery over HTTP", async () => {
    executeMock.mockResolvedValue({
      success: true,
      outcome: "CANCELLED",
      providerCancellationId: "PC-HTTP-1",
      status: "CANCELLED",
      reason: null,
      cancelledAt: new Date().toISOString(),
    });

    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });

    const app = buildApp();
    const res = await request(app)
      .post(`/api/v1/deliveries/${seeded.deliveryId}/cancel`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reasonCode: "CUSTOMER_CHANGED_MIND" });

    expect(res.status).toBe(200);
    expect(res.body.data.delivery.status).toBe("CANCELLED");
  });
});
