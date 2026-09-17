import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { createAuthenticateMiddleware } from "../src/core/middleware/authenticate.js";
import { errorHandlerMiddleware } from "../src/core/middleware/error-handler.js";
import { notFoundMiddleware } from "../src/core/middleware/not-found.js";
import { requestIdMiddleware } from "../src/core/middleware/request-id.js";
import { generateAccessToken } from "../src/modules/auth/auth.crypto.js";
import { DeliveryLifecycleService } from "../src/modules/delivery/delivery-lifecycle.service.js";
import {
  createAdminOperationalRouter,
  createOperationalRouter,
} from "../src/modules/operations/operational.routes.js";
import { MockProviderAdapter } from "../src/modules/provider/adapters/mock/mock-provider.adapter.js";
import { MOCK_BOOKING_ID } from "../src/modules/provider/adapters/mock/mock-provider.constants.js";
import { ProviderAdapterExecutor } from "../src/modules/provider/adapters/provider-adapter-executor.js";
import { ProviderAdapterRegistry } from "../src/modules/provider/adapters/provider-adapter-registry.js";
import { ProviderAdapterResolver } from "../src/modules/provider/adapters/provider-adapter-resolver.js";
import { ProviderConfigResolver } from "../src/modules/provider/adapters/provider-config-resolver.js";
import { TrackingController } from "../src/modules/tracking/tracking.controller.js";
import { TrackingService } from "../src/modules/tracking/tracking.service.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { InMemoryTrackingRepository } from "./helpers/in-memory-tracking-repository.js";
import { seedBookedDelivery } from "./helpers/operational-test-helpers.js";
import { seedMockProvider } from "./helpers/provider-adapter-test-helpers.js";

describe("Tracking refresh HTTP", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let bookingRepo: InMemoryBookingRepository;
  let trackingRepo: InMemoryTrackingRepository;
  let orchestrationRepo: InMemoryOrchestrationRepository;
  let providerRepo: InMemoryProviderRepository;
  let authRepo: InMemoryAuthRepository;
  let customerId: string;
  let otherCustomerId: string;
  let customerToken: string;
  let adminToken: string;

  beforeEach(async () => {
    deliveryRepo = new InMemoryDeliveryRepository();
    bookingRepo = new InMemoryBookingRepository();
    trackingRepo = new InMemoryTrackingRepository();
    orchestrationRepo = new InMemoryOrchestrationRepository();
    providerRepo = new InMemoryProviderRepository();
    authRepo = new InMemoryAuthRepository();

    const customer = await authRepo.createUser({
      name: "Customer",
      email: "tracking-customer@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    customer.role = "CUSTOMER";
    customerId = customer.id;
    customerToken = generateAccessToken(customerId);

    const otherCustomer = await authRepo.createUser({
      name: "Other",
      email: "tracking-other@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    otherCustomer.role = "CUSTOMER";
    otherCustomerId = otherCustomer.id;

    const admin = await authRepo.createUser({
      name: "Admin",
      email: "tracking-admin@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    admin.role = "ADMIN";
    adminToken = generateAccessToken(admin.id);
  });

  function buildApp(options?: {
    capabilities?: Parameters<typeof seedMockProvider>[1]["capabilities"];
  }) {
    const registry = new ProviderAdapterRegistry();
    registry.register(new MockProviderAdapter());
    const resolver = new ProviderAdapterResolver(
      registry,
      new ProviderConfigResolver(providerRepo),
    );
    const executor = new ProviderAdapterExecutor(resolver);
    const trackingService = new TrackingService(
      deliveryRepo,
      bookingRepo,
      trackingRepo,
      new DeliveryLifecycleService(deliveryRepo),
      executor,
    );
    const trackingController = new TrackingController(trackingService);
    const authenticate = createAuthenticateMiddleware(authRepo);

    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use(
      "/api/v1/deliveries",
      createOperationalRouter({
        trackingController,
        authenticateMiddleware: authenticate,
      }),
    );
    app.use(
      "/api/v1/admin/deliveries",
      createAdminOperationalRouter({
        trackingController,
        authenticateMiddleware: authenticate,
      }),
    );
    app.use(notFoundMiddleware);
    app.use(errorHandlerMiddleware);

    return { app, seedCapabilities: options?.capabilities };
  }

  async function seedDeliveryWithMockCapabilities(
    capabilities?: Parameters<typeof seedMockProvider>[1]["capabilities"],
  ) {
    await seedMockProvider(providerRepo, {
      integrationStatus: "READY",
      capabilities,
    });
    return seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
      providerOrderId: MOCK_BOOKING_ID,
    });
  }

  it("allows ADMIN to refresh tracking when MOCK has tracking capabilities", async () => {
    const { app } = buildApp();
    const seeded = await seedDeliveryWithMockCapabilities();
    await deliveryRepo.transitionStatus({
      deliveryId: seeded.deliveryId,
      expectedFromStatuses: ["BOOKED"],
      toStatus: "PICKED_UP",
      source: "OTP",
      reason: "test pickup",
    });

    const res = await request(app)
      .post(`/api/v1/admin/deliveries/${seeded.deliveryId}/tracking/refresh`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tracking?.trackingUrl).toBe(
      `https://mock-provider.test/track/${MOCK_BOOKING_ID}`,
    );
    expect(res.body.data.tracking?.normalizedStatus).toBe("IN_TRANSIT");
    expect(trackingRepo.points).toHaveLength(1);
  });

  it("returns 422 when MOCK provider lacks tracking capabilities", async () => {
    const { app } = buildApp();
    const seeded = await seedDeliveryWithMockCapabilities(["BOOKING", "WEBHOOKS"]);

    const res = await request(app)
      .post(`/api/v1/admin/deliveries/${seeded.deliveryId}/tracking/refresh`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe(ErrorCodes.PROVIDER_UNSUPPORTED_OPERATION);
    expect(trackingRepo.points).toHaveLength(0);
  });

  it("creates a new tracking point on each refresh with unique mock event ids", async () => {
    const { app } = buildApp();
    const seeded = await seedDeliveryWithMockCapabilities();
    await deliveryRepo.transitionStatus({
      deliveryId: seeded.deliveryId,
      expectedFromStatuses: ["BOOKED"],
      toStatus: "PICKED_UP",
      source: "OTP",
      reason: "test pickup",
    });

    await request(app)
      .post(`/api/v1/admin/deliveries/${seeded.deliveryId}/tracking/refresh`)
      .set("Authorization", `Bearer ${adminToken}`);

    await request(app)
      .post(`/api/v1/admin/deliveries/${seeded.deliveryId}/tracking/refresh`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(trackingRepo.points).toHaveLength(2);
  });

  it("denies CUSTOMER access to admin tracking refresh", async () => {
    const { app } = buildApp();
    const seeded = await seedDeliveryWithMockCapabilities();

    const res = await request(app)
      .post(`/api/v1/admin/deliveries/${seeded.deliveryId}/tracking/refresh`)
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(403);
  });

  it("returns 404 when customer requests tracking for another user's delivery", async () => {
    const { app } = buildApp();
    const seeded = await seedDeliveryWithMockCapabilities();
    const otherToken = generateAccessToken(otherCustomerId);

    const res = await request(app)
      .get(`/api/v1/deliveries/${seeded.deliveryId}/tracking`)
      .set("Authorization", `Bearer ${otherToken}`);

    expect(res.status).toBe(404);
  });

  it("rejects unauthenticated admin tracking refresh", async () => {
    const { app } = buildApp();

    const res = await request(app).post(
      `/api/v1/admin/deliveries/00000000-0000-4000-8000-000000000001/tracking/refresh`,
    );

    expect(res.status).toBe(401);
  });
});
