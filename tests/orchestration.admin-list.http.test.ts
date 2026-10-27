import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { createAuthenticateMiddleware } from "../src/core/middleware/authenticate.js";
import { errorHandlerMiddleware } from "../src/core/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/core/middleware/request-id.js";
import { generateAccessToken } from "../src/modules/auth/auth.crypto.js";
import { createAdminOrchestrationListRouter } from "../src/modules/orchestration/orchestration-admin-list.routes.js";
import { OrchestrationController } from "../src/modules/orchestration/orchestration.controller.js";
import { orchestrationProviderEvaluationService } from "../src/modules/orchestration/orchestration.provider-evaluation.js";
import { OrchestrationService } from "../src/modules/orchestration/orchestration.service.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { seedDeliveredDelivery } from "./helpers/operational-test-helpers.js";
import { seedOptionReadyDelivery } from "./helpers/booking-test-helpers.js";

describe("Orchestration admin list HTTP", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let orchestrationRepo: InMemoryOrchestrationRepository;
  let providerRepo: InMemoryProviderRepository;
  let bookingRepo: InMemoryBookingRepository;
  let authRepo: InMemoryAuthRepository;
  let customerId: string;
  let customerToken: string;
  let adminToken: string;

  beforeEach(async () => {
    deliveryRepo = new InMemoryDeliveryRepository();
    orchestrationRepo = new InMemoryOrchestrationRepository();
    providerRepo = new InMemoryProviderRepository();
    bookingRepo = new InMemoryBookingRepository();
    authRepo = new InMemoryAuthRepository();

    const customer = await authRepo.createUser({
      name: "Customer",
      email: "customer-orch-list@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    customer.role = "CUSTOMER";
    customerId = customer.id;
    customerToken = generateAccessToken(customerId);

    const admin = await authRepo.createUser({
      name: "Admin",
      email: "admin-orch-list@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    admin.role = "ADMIN";
    adminToken = generateAccessToken(admin.id);
  });

  function buildApp() {
    const authenticate = createAuthenticateMiddleware(authRepo);
    const orchestrationService = new OrchestrationService(
      deliveryRepo,
      providerRepo,
      orchestrationRepo,
      orchestrationProviderEvaluationService,
      15_000,
      bookingRepo,
    );
    const orchestrationController = new OrchestrationController(orchestrationService);

    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use(
      "/api/v1/admin/orchestrations",
      createAdminOrchestrationListRouter({
        controller: orchestrationController,
        authenticateMiddleware: authenticate,
      }),
    );
    app.use(errorHandlerMiddleware);
    return app;
  }

  it("rejects unauthenticated admin orchestration list requests", async () => {
    const app = buildApp();
    expect((await request(app).get("/api/v1/admin/orchestrations")).status).toBe(401);
  });

  it("forbids CUSTOMER from using the admin orchestration list endpoint", async () => {
    const app = buildApp();
    const response = await request(app)
      .get("/api/v1/admin/orchestrations")
      .set("Authorization", `Bearer ${customerToken}`);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it("returns paginated orchestration rows for ADMIN", async () => {
    const first = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
    });
    const second = await seedDeliveredDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });

    const app = buildApp();
    const response = await request(app)
      .get("/api/v1/admin/orchestrations?limit=20&page=1")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.total).toBe(2);
    expect(response.body.data.page).toBe(1);
    expect(response.body.data.limit).toBe(20);
    expect(response.body.data.totalPages).toBe(1);

    const ids = response.body.data.items.map(
      (item: { orchestrationId: string }) => item.orchestrationId,
    );
    expect(ids).toEqual(
      expect.arrayContaining([
        first.orchestrationRequestId,
        second.orchestrationRequestId,
      ]),
    );

    const deliveredRow = response.body.data.items.find(
      (item: { deliveryId: string }) => item.deliveryId === second.deliveryId,
    );
    expect(deliveredRow.deliveryReference).toBe(second.deliveryReference);
    expect(deliveredRow.orchestrationStatus).toBe("COMPLETED");
    expect(deliveredRow.evaluationCount).toBeGreaterThan(0);
    expect(deliveredRow.selectedProviderCode).toBeTruthy();
    expect(deliveredRow.booking?.status).toBe("BOOKED");
  });

  it("filters by reference and orchestration status", async () => {
    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
    });

    const app = buildApp();

    const byReference = await request(app)
      .get(
        `/api/v1/admin/orchestrations?reference=${encodeURIComponent(seeded.deliveryReference)}`,
      )
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byReference.status).toBe(200);
    expect(byReference.body.data.total).toBe(1);
    expect(byReference.body.data.items[0].deliveryId).toBe(seeded.deliveryId);

    const byStatus = await request(app)
      .get("/api/v1/admin/orchestrations?orchestrationStatus=COMPLETED")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byStatus.status).toBe(200);
    expect(byStatus.body.data.total).toBe(1);
  });

  it("validates date range query params", async () => {
    const app = buildApp();
    const response = await request(app)
      .get(
        "/api/v1/admin/orchestrations?from=2026-02-01T00:00:00%2B05:30&to=2026-01-01T00:00:00%2B05:30",
      )
      .set("Authorization", `Bearer ${adminToken}`);
    expect(response.status).toBe(400);
  });

  it("handles missing booking safely", async () => {
    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
    });

    const app = buildApp();
    const response = await request(app)
      .get("/api/v1/admin/orchestrations")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    const row = response.body.data.items.find(
      (item: { orchestrationId: string }) =>
        item.orchestrationId === seeded.orchestrationRequestId,
    );
    expect(row.booking).toBeNull();
  });
});
