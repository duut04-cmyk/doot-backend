import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuthenticateMiddleware } from "../src/core/middleware/authenticate.js";
import { errorHandlerMiddleware } from "../src/core/middleware/error-handler.js";
import { notFoundMiddleware } from "../src/core/middleware/not-found.js";
import { requestIdMiddleware } from "../src/core/middleware/request-id.js";
import { generateAccessToken } from "../src/modules/auth/auth.crypto.js";
import { DeliveryLifecycleService } from "../src/modules/delivery/delivery-lifecycle.service.js";
import { DriverController } from "../src/modules/driver/driver.controller.js";
import { DriverService } from "../src/modules/driver/driver.service.js";
import {
  createAdminOperationalRouter,
  createOperationalRouter,
} from "../src/modules/operations/operational.routes.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryDriverRepository } from "./helpers/in-memory-driver-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { seedBookedDelivery } from "./helpers/operational-test-helpers.js";

const simulatePayload = {
  status: "ASSIGNED" as const,
  providerDriverId: "MOCK-DRIVER-001",
  driverName: "Aman Singh",
  driverPhoneCountryCode: "+91",
  driverPhoneNumber: "9876543210",
  providerRating: 4.8,
  vehicleType: "BIKE" as const,
  vehicleNumber: "PB10AB1234",
};

describe("Driver simulation HTTP", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let bookingRepo: InMemoryBookingRepository;
  let driverRepo: InMemoryDriverRepository;
  let orchestrationRepo: InMemoryOrchestrationRepository;
  let providerRepo: InMemoryProviderRepository;
  let authRepo: InMemoryAuthRepository;
  let customerId: string;
  let customerToken: string;
  let adminToken: string;

  beforeEach(async () => {
    deliveryRepo = new InMemoryDeliveryRepository();
    bookingRepo = new InMemoryBookingRepository();
    driverRepo = new InMemoryDriverRepository();
    orchestrationRepo = new InMemoryOrchestrationRepository();
    providerRepo = new InMemoryProviderRepository();
    authRepo = new InMemoryAuthRepository();
    const customer = await authRepo.createUser({
      name: "Customer",
      email: "simulate-customer@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    customer.role = "CUSTOMER";
    customerId = customer.id;
    customerToken = generateAccessToken(customerId);

    const admin = await authRepo.createUser({
      name: "Admin",
      email: "simulate-admin@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    admin.role = "ADMIN";
    adminToken = generateAccessToken(admin.id);
  });

  function buildApp(options?: { enableDriverSimulation?: boolean }) {
    const lifecycle = new DeliveryLifecycleService(deliveryRepo);
    const driverService = new DriverService(
      deliveryRepo,
      bookingRepo,
      driverRepo,
      lifecycle,
    );
    const driverController = new DriverController(driverService);
    const authenticate = createAuthenticateMiddleware(authRepo);

    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use(
      "/api/v1/deliveries",
      createOperationalRouter({
        driverController,
        authenticateMiddleware: authenticate,
      }),
    );
    app.use(
      "/api/v1/admin/deliveries",
      createAdminOperationalRouter({
        driverController,
        authenticateMiddleware: authenticate,
        enableDriverSimulation: options?.enableDriverSimulation,
      }),
    );
    app.use(notFoundMiddleware);
    app.use(errorHandlerMiddleware);
    return app;
  }

  it("allows ADMIN to simulate driver assignment from BOOKED", async () => {
    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });
    const app = buildApp();

    const res = await request(app)
      .post(`/api/v1/admin/deliveries/${seeded.deliveryId}/driver/simulate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(simulatePayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.known).toBe(true);
    expect(res.body.data.assigned).toBe(true);
    expect(res.body.data.driver.name).toBe("Aman Singh");

    const delivery = await deliveryRepo.findById(seeded.deliveryId);
    expect(delivery?.status).toBe("DRIVER_ASSIGNED");
  });

  it("returns driver data on customer GET /driver after simulation", async () => {
    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });
    const app = buildApp();

    await request(app)
      .post(`/api/v1/admin/deliveries/${seeded.deliveryId}/driver/simulate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(simulatePayload);

    const res = await request(app)
      .get(`/api/v1/deliveries/${seeded.deliveryId}/driver`)
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.known).toBe(true);
    expect(res.body.data.assigned).toBe(true);
    expect(res.body.data.driver.vehicleNumber).toBe("PB10AB1234");
  });

  it("denies CUSTOMER access to simulation endpoint", async () => {
    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });
    const app = buildApp();

    const res = await request(app)
      .post(`/api/v1/admin/deliveries/${seeded.deliveryId}/driver/simulate`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send(simulatePayload);

    expect(res.status).toBe(403);
  });

  it("rejects unauthenticated simulation requests", async () => {
    const app = buildApp();

    const res = await request(app)
      .post(
        `/api/v1/admin/deliveries/00000000-0000-4000-8000-000000000001/driver/simulate`,
      )
      .send(simulatePayload);

    expect(res.status).toBe(401);
  });

  it("returns 404 for simulation on nonexistent delivery", async () => {
    const app = buildApp();

    const res = await request(app)
      .post(
        `/api/v1/admin/deliveries/00000000-0000-4000-8000-000000000001/driver/simulate`,
      )
      .set("Authorization", `Bearer ${adminToken}`)
      .send(simulatePayload);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("DELIVERY_NOT_FOUND");
  });

  it("rejects simulation for invalid delivery state", async () => {
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

    const app = buildApp();
    const res = await request(app)
      .post(`/api/v1/admin/deliveries/${seeded.deliveryId}/driver/simulate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(simulatePayload);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DELIVERY_INVALID_TRANSITION");
  });

  it("does not register simulation endpoint when disabled for production", async () => {
    const app = buildApp({ enableDriverSimulation: false });

    const res = await request(app)
      .post(
        `/api/v1/admin/deliveries/00000000-0000-4000-8000-000000000001/driver/simulate`,
      )
      .set("Authorization", `Bearer ${adminToken}`)
      .send(simulatePayload);

    expect(res.status).toBe(404);
  });

  it("does not create duplicate assignments on repeated simulation", async () => {
    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });
    const app = buildApp();

    await request(app)
      .post(`/api/v1/admin/deliveries/${seeded.deliveryId}/driver/simulate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(simulatePayload);

    await request(app)
      .post(`/api/v1/admin/deliveries/${seeded.deliveryId}/driver/simulate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ...simulatePayload, driverName: "Updated Driver" });

    const assigned = driverRepo.assignments.filter(
      (item) => item.deliveryId === seeded.deliveryId && item.status === "ASSIGNED",
    );
    expect(assigned).toHaveLength(1);
    expect(assigned[0]?.driverName).toBe("Updated Driver");
  });
});
