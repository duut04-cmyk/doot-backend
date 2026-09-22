import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateAccessToken } from "../src/modules/auth/auth.crypto.js";
import { createAuthenticateMiddleware } from "../src/core/middleware/authenticate.js";
import { errorHandlerMiddleware } from "../src/core/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/core/middleware/request-id.js";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
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
import { createNoopEmailSender } from "./helpers/email-test-helpers.js";
import { seedOptionReadyDelivery } from "./helpers/booking-test-helpers.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryCancellationRepository } from "./helpers/in-memory-cancellation-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryDriverRepository } from "./helpers/in-memory-driver-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryOtpRepository } from "./helpers/in-memory-otp-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { InMemoryTrackingRepository } from "./helpers/in-memory-tracking-repository.js";
import { seedInTransitDelivery } from "./helpers/otp-test-helpers.js";
import { seedBookedDelivery } from "./helpers/operational-test-helpers.js";

describe("Cancellation HTTP", () => {
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
  let otherCustomerId: string;
  let token: string;
  let otherToken: string;

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
      email: "cancel@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    customer.role = "CUSTOMER";
    customerId = customer.id;
    token = generateAccessToken(customerId);

    const other = await authRepo.createUser({
      name: "Other",
      email: "other@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    other.role = "CUSTOMER";
    otherCustomerId = other.id;
    otherToken = generateAccessToken(otherCustomerId);
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

  it("returns 401 without auth on cancel endpoint", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/v1/deliveries/00000000-0000-4000-8000-000000000001/cancel")
      .send({ reasonCode: "CUSTOMER_CHANGED_MIND" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(ErrorCodes.UNAUTHORIZED);
  });

  it("returns 401 without auth on get cancellation endpoint", async () => {
    const app = buildApp();
    const res = await request(app).get(
      "/api/v1/deliveries/00000000-0000-4000-8000-000000000001/cancellation",
    );

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(ErrorCodes.UNAUTHORIZED);
  });

  it("returns 404 when another customer cancels a delivery", async () => {
    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
    });

    const app = buildApp();
    const res = await request(app)
      .post(`/api/v1/deliveries/${seeded.deliveryId}/cancel`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ reasonCode: "CUSTOMER_CHANGED_MIND" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(ErrorCodes.DELIVERY_NOT_FOUND);
  });

  it("returns 403 for suspended users on cancel endpoint", async () => {
    const suspended = await authRepo.createUser({
      name: "Suspended",
      email: "suspended-cancel@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    suspended.role = "CUSTOMER";
    suspended.status = "SUSPENDED";
    const suspendedToken = generateAccessToken(suspended.id);

    const app = buildApp();
    const res = await request(app)
      .post("/api/v1/deliveries/00000000-0000-4000-8000-000000000001/cancel")
      .set("Authorization", `Bearer ${suspendedToken}`)
      .send({ reasonCode: "CUSTOMER_CHANGED_MIND" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(ErrorCodes.ACCOUNT_SUSPENDED);
  });

  it("returns 422 for post-pickup cancellation over HTTP", async () => {
    const otpService = new OtpService(
      deliveryRepo,
      otpRepo,
      new DeliveryLifecycleService(deliveryRepo),
      authRepo,
      createNoopEmailSender(),
    );
    const seeded = await seedInTransitDelivery({
      service: otpService,
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

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe(ErrorCodes.CANCELLATION_NOT_ALLOWED);
  });

  it("returns 400 for invalid cancellation reason code", async () => {
    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
    });

    const app = buildApp();
    const res = await request(app)
      .post(`/api/v1/deliveries/${seeded.deliveryId}/cancel`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reasonCode: "NOT_A_VALID_REASON" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it("cancels booked delivery and exposes cancellation details over HTTP", async () => {
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
    const cancelRes = await request(app)
      .post(`/api/v1/deliveries/${seeded.deliveryId}/cancel`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reasonCode: "CUSTOMER_CHANGED_MIND" });

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.delivery.status).toBe("CANCELLED");

    const getRes = await request(app)
      .get(`/api/v1/deliveries/${seeded.deliveryId}/cancellation`)
      .set("Authorization", `Bearer ${token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.cancellation.status).toBe("CANCELLED");
    expect(getRes.body.data.cancellation.reasonCode).toBe("CUSTOMER_CHANGED_MIND");
  });

  it("returns cached cancel response for repeated idempotency key", async () => {
    executeMock.mockResolvedValue({
      success: true,
      outcome: "CANCELLED",
      providerCancellationId: "PC-IDEM",
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
    const key = randomUUID();

    const app = buildApp();
    const first = await request(app)
      .post(`/api/v1/deliveries/${seeded.deliveryId}/cancel`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send({ reasonCode: "CUSTOMER_CHANGED_MIND" });

    const second = await request(app)
      .post(`/api/v1/deliveries/${seeded.deliveryId}/cancel`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send({ reasonCode: "CUSTOMER_CHANGED_MIND" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data).toEqual(first.body.data);
    expect(executeMock).toHaveBeenCalledOnce();
  });

  it("returns 409 when idempotency key is reused with different body", async () => {
    executeMock.mockResolvedValue({
      success: true,
      outcome: "CANCELLED",
      providerCancellationId: "PC-IDEM-CONFLICT",
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
    const key = randomUUID();

    const app = buildApp();
    await request(app)
      .post(`/api/v1/deliveries/${seeded.deliveryId}/cancel`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send({ reasonCode: "CUSTOMER_CHANGED_MIND" });

    const conflict = await request(app)
      .post(`/api/v1/deliveries/${seeded.deliveryId}/cancel`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send({ reasonCode: "WRONG_ADDRESS" });

    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe(ErrorCodes.IDEMPOTENCY_CONFLICT);
  });

  it("returns 422 when provider rejects cancellation over HTTP", async () => {
    executeMock.mockResolvedValue({
      success: false,
      outcome: "REJECTED",
      providerCancellationId: null,
      status: "ACTIVE",
      reason: "Cannot cancel now",
      cancelledAt: null,
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

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe(ErrorCodes.PROVIDER_CANCELLATION_REJECTED);
  });
});
