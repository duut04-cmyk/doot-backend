import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { createAuthenticateMiddleware } from "../src/core/middleware/authenticate.js";
import { errorHandlerMiddleware } from "../src/core/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/core/middleware/request-id.js";
import { generateAccessToken } from "../src/modules/auth/auth.crypto.js";
import { createAdminDeliveryListRouter } from "../src/modules/delivery/delivery-admin-list.routes.js";
import { DeliveryController } from "../src/modules/delivery/delivery.controller.js";
import { createDeliveryRouter } from "../src/modules/delivery/delivery.routes.js";
import { DeliveryService } from "../src/modules/delivery/delivery.service.js";
import { OrchestrationController } from "../src/modules/orchestration/orchestration.controller.js";
import { OrchestrationService } from "../src/modules/orchestration/orchestration.service.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { seedDeliveredDelivery } from "./helpers/operational-test-helpers.js";
import { seedOptionReadyDelivery } from "./helpers/booking-test-helpers.js";

describe("Delivery admin access HTTP", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let orchestrationRepo: InMemoryOrchestrationRepository;
  let providerRepo: InMemoryProviderRepository;
  let bookingRepo: InMemoryBookingRepository;
  let authRepo: InMemoryAuthRepository;
  let customerAId: string;
  let customerBId: string;
  let customerAToken: string;
  let customerBToken: string;
  let adminToken: string;

  beforeEach(async () => {
    deliveryRepo = new InMemoryDeliveryRepository();
    orchestrationRepo = new InMemoryOrchestrationRepository();
    providerRepo = new InMemoryProviderRepository();
    bookingRepo = new InMemoryBookingRepository();
    authRepo = new InMemoryAuthRepository();

    const customerA = await authRepo.createUser({
      name: "Customer A",
      email: "customer-a-list@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    customerA.role = "CUSTOMER";
    customerAId = customerA.id;
    customerAToken = generateAccessToken(customerAId);

    const customerB = await authRepo.createUser({
      name: "Customer B",
      email: "customer-b-list@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    customerB.role = "CUSTOMER";
    customerBId = customerB.id;
    customerBToken = generateAccessToken(customerBId);

    const admin = await authRepo.createUser({
      name: "Admin",
      email: "admin-list@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    admin.role = "ADMIN";
    adminToken = generateAccessToken(admin.id);
  });

  function buildApp() {
    const authenticate = createAuthenticateMiddleware(authRepo);
    const deliveryService = new DeliveryService(deliveryRepo);
    const deliveryController = new DeliveryController(deliveryService);
    const orchestrationService = new OrchestrationService(
      deliveryRepo,
      providerRepo,
      orchestrationRepo,
    );
    const orchestrationController = new OrchestrationController(orchestrationService);

    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use(
      "/api/v1/deliveries",
      createDeliveryRouter(deliveryController, orchestrationController, undefined, {
        authenticateMiddleware: authenticate,
      }),
    );
    app.use(
      "/api/v1/admin/deliveries",
      createAdminDeliveryListRouter({
        controller: deliveryController,
        authenticateMiddleware: authenticate,
      }),
    );
    app.use(errorHandlerMiddleware);
    return app;
  }

  it("rejects unauthenticated customer and admin delivery list requests", async () => {
    const app = buildApp();
    expect((await request(app).get("/api/v1/deliveries")).status).toBe(401);
    expect((await request(app).get("/api/v1/admin/deliveries")).status).toBe(401);
  });

  it("allows ADMIN cross-customer listing on the admin deliveries endpoint", async () => {
    const first = await seedDeliveredDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId: customerAId,
    });
    const second = await seedDeliveredDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId: customerBId,
    });

    const app = buildApp();
    const response = await request(app)
      .get("/api/v1/admin/deliveries?limit=20")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.total).toBe(2);
    const ids = response.body.data.items.map((item: { id: string }) => item.id);
    expect(ids).toEqual(expect.arrayContaining([first.deliveryId, second.deliveryId]));
  });

  it("forbids ADMIN from using the customer delivery list endpoint", async () => {
    const app = buildApp();
    const response = await request(app)
      .get("/api/v1/deliveries")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it("forbids CUSTOMER from using the admin delivery list endpoint", async () => {
    const app = buildApp();
    const response = await request(app)
      .get("/api/v1/admin/deliveries")
      .set("Authorization", `Bearer ${customerAToken}`);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it("keeps CUSTOMER delivery lists scoped to their own deliveries", async () => {
    await seedDeliveredDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId: customerAId,
    });
    await seedDeliveredDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId: customerBId,
    });

    const app = buildApp();
    const listA = await request(app)
      .get("/api/v1/deliveries?limit=20")
      .set("Authorization", `Bearer ${customerAToken}`);
    expect(listA.status).toBe(200);
    expect(listA.body.data.total).toBe(1);

    const listB = await request(app)
      .get("/api/v1/deliveries?limit=20")
      .set("Authorization", `Bearer ${customerBToken}`);
    expect(listB.status).toBe(200);
    expect(listB.body.data.total).toBe(1);
    expect(listB.body.data.items[0]?.id).not.toBe(listA.body.data.items[0]?.id);
  });

  it("does not broaden CUSTOMER access when filtering by another customer's reference", async () => {
    const seededA = await seedDeliveredDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId: customerAId,
    });
    await seedDeliveredDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId: customerBId,
    });

    const app = buildApp();
    const response = await request(app)
      .get(
        `/api/v1/deliveries?reference=${encodeURIComponent(seededA.deliveryReference)}`,
      )
      .set("Authorization", `Bearer ${customerBToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(0);
    expect(response.body.data.items).toHaveLength(0);
  });

  it("returns reference matches for ADMIN without exposing unrelated deliveries", async () => {
    const seededA = await seedDeliveredDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId: customerAId,
    });
    await seedDeliveredDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId: customerBId,
    });

    const app = buildApp();
    const response = await request(app)
      .get(
        `/api/v1/admin/deliveries?reference=${encodeURIComponent(seededA.deliveryReference)}`,
      )
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
    expect(response.body.data.items[0]?.id).toBe(seededA.deliveryId);
    expect(response.body.data.items[0]?.reference).toBe(seededA.deliveryReference);
  });

  it("returns ADMIN orchestration evaluations for an authorized delivery", async () => {
    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId: customerAId,
    });

    const app = buildApp();
    const response = await request(app)
      .get(`/api/v1/deliveries/${seeded.deliveryId}/orchestration`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.orchestration.evaluations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerCode: "MOCK",
          status: "ELIGIBLE",
        }),
      ]),
    );
    expect(response.body.data.orchestration).toHaveProperty("status");
    expect(response.body.data.orchestration).toHaveProperty("failureReason");
  });

  it("returns customer-safe orchestration payload for the owning customer", async () => {
    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId: customerAId,
    });

    const app = buildApp();
    const response = await request(app)
      .get(`/api/v1/deliveries/${seeded.deliveryId}/orchestration`)
      .set("Authorization", `Bearer ${customerAToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.orchestration.selectedOption).toEqual(
      expect.objectContaining({
        providerCode: "MOCK",
      }),
    );
    expect(response.body.data.orchestration).not.toHaveProperty("evaluations");
  });

  it("forbids CUSTOMER orchestration read for another customer's delivery", async () => {
    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId: customerAId,
    });

    const app = buildApp();
    const response = await request(app)
      .get(`/api/v1/deliveries/${seeded.deliveryId}/orchestration`)
      .set("Authorization", `Bearer ${customerBToken}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe(ErrorCodes.DELIVERY_NOT_FOUND);
  });
});
