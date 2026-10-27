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
import { seedOptionReadyDelivery } from "./helpers/booking-test-helpers.js";

describe("Orchestration admin detail HTTP", () => {
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
      email: "customer-orch-detail@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    customer.role = "CUSTOMER";
    customerId = customer.id;
    customerToken = generateAccessToken(customerId);

    const admin = await authRepo.createUser({
      name: "Admin",
      email: "admin-orch-detail@example.com",
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

  it("rejects unauthenticated and CUSTOMER access", async () => {
    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
    });
    const app = buildApp();
    const path = `/api/v1/admin/orchestrations/${seeded.orchestrationRequestId}`;

    expect((await request(app).get(path)).status).toBe(401);

    const forbidden = await request(app)
      .get(path)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it("returns exact orchestration run with evaluations and delivery summary", async () => {
    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
    });

    const app = buildApp();
    const response = await request(app)
      .get(`/api/v1/admin/orchestrations/${seeded.orchestrationRequestId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.orchestration.id).toBe(seeded.orchestrationRequestId);
    expect(response.body.data.orchestration.attemptNumber).toBe(1);
    expect(response.body.data.deliveryId).toBe(seeded.deliveryId);
    expect(response.body.data.delivery.reference).toBe(seeded.deliveryReference);
    expect(response.body.data.orchestration.evaluations.length).toBeGreaterThan(0);
    expect(response.body.data.orchestration.selectedOption).toBeTruthy();
    expect(response.body.data.booking).toBeNull();
    expect(response.body.data.durationMs).toBeTypeOf("number");
  });

  it("returns the requested run when a delivery has multiple attempts", async () => {
    const first = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
      providerCode: "MOCK_A",
    });

    const secondRequest = await orchestrationRepo.createRequest({
      deliveryId: first.deliveryId,
      requestedByUserId: customerId,
      attemptNumber: 2,
    });
    await orchestrationRepo.completeRequest({
      requestId: secondRequest.id,
      status: "FAILED",
      failureReason: "Second attempt failed",
    });

    const app = buildApp();
    const firstResponse = await request(app)
      .get(`/api/v1/admin/orchestrations/${first.orchestrationRequestId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    const secondResponse = await request(app)
      .get(`/api/v1/admin/orchestrations/${secondRequest.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(firstResponse.body.data.orchestration.status).toBe("COMPLETED");
    expect(secondResponse.body.data.orchestration.status).toBe("FAILED");
    expect(secondResponse.body.data.orchestration.failureReason).toBe(
      "Second attempt failed",
    );
    expect(firstResponse.body.data.orchestration.id).not.toBe(
      secondResponse.body.data.orchestration.id,
    );
  });

  it("returns 404 for unknown orchestration id", async () => {
    const app = buildApp();
    const response = await request(app)
      .get("/api/v1/admin/orchestrations/00000000-0000-4000-8000-000000000099")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe(ErrorCodes.ORCHESTRATION_NOT_FOUND);
  });

  it("returns 400 for invalid orchestration id", async () => {
    const app = buildApp();
    const response = await request(app)
      .get("/api/v1/admin/orchestrations/not-a-uuid")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(response.status).toBe(400);
  });
});
