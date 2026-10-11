import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuthenticateMiddleware } from "../src/core/middleware/authenticate.js";
import { errorHandlerMiddleware } from "../src/core/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/core/middleware/request-id.js";
import { createAdminDeliveryHistoryRouter } from "../src/modules/delivery/delivery-history.routes.js";
import { createDeliveryRouter } from "../src/modules/delivery/delivery.routes.js";
import { DeliveryController } from "../src/modules/delivery/delivery.controller.js";
import { DeliveryService } from "../src/modules/delivery/delivery.service.js";
import { DeliveryHistoryService } from "../src/modules/delivery/delivery-history.service.js";
import { ExperienceController } from "../src/modules/experience/experience.controller.js";
import { ExperienceService } from "../src/modules/experience/experience.service.js";
import { generateAccessToken } from "../src/modules/auth/auth.crypto.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryCancellationRepository } from "./helpers/in-memory-cancellation-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryDriverRepository } from "./helpers/in-memory-driver-repository.js";
import { InMemoryFeedbackRepository } from "./helpers/in-memory-feedback-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryOtpRepository } from "./helpers/in-memory-otp-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { InMemoryRatingRepository } from "./helpers/in-memory-rating-repository.js";
import { InMemoryTrackingRepository } from "./helpers/in-memory-tracking-repository.js";
import { seedDeliveredDelivery } from "./helpers/operational-test-helpers.js";

const experienceBody = {
  driverRating: 5,
  platformRating: 5,
  deliveryRating: 4,
  timelinessRating: 5,
  packageHandlingRating: 5,
  servicePresentationRating: 4,
  comment: "Phase 8 HTTP experience",
};

describe("Phase 8 HTTP", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let ratingRepo: InMemoryRatingRepository;
  let feedbackRepo: InMemoryFeedbackRepository;
  let authRepo: InMemoryAuthRepository;
  let customerId: string;
  let customerToken: string;
  let otherToken: string;
  let adminToken: string;

  beforeEach(async () => {
    deliveryRepo = new InMemoryDeliveryRepository();
    ratingRepo = new InMemoryRatingRepository(deliveryRepo);
    feedbackRepo = new InMemoryFeedbackRepository(deliveryRepo);
    authRepo = new InMemoryAuthRepository();

    const customer = await authRepo.createUser({
      name: "Customer",
      email: "phase8@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    customer.role = "CUSTOMER";
    customerId = customer.id;
    customerToken = generateAccessToken(customerId);

    const other = await authRepo.createUser({
      name: "Other",
      email: "other-phase8@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    other.role = "CUSTOMER";
    otherToken = generateAccessToken(other.id);

    const admin = await authRepo.createUser({
      name: "Admin",
      email: "admin-phase8@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    admin.role = "ADMIN";
    adminToken = generateAccessToken(admin.id);
  });

  function buildCustomerApp() {
    const authenticate = createAuthenticateMiddleware(authRepo);
    const historyService = new DeliveryHistoryService(
      deliveryRepo,
      new InMemoryOrchestrationRepository(),
      new InMemoryBookingRepository(),
      new InMemoryDriverRepository(),
      new InMemoryTrackingRepository(),
      new InMemoryCancellationRepository(),
      new InMemoryOtpRepository(),
      ratingRepo,
      feedbackRepo,
    );
    const deliveryController = new DeliveryController(
      new DeliveryService(deliveryRepo),
      historyService,
    );
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use(
      "/api/v1/deliveries",
      createDeliveryRouter(deliveryController, undefined, undefined, {
        experienceController: new ExperienceController(
          new ExperienceService(deliveryRepo, ratingRepo, feedbackRepo),
        ),
        authenticateMiddleware: authenticate,
      }),
    );
    app.use(errorHandlerMiddleware);
    return app;
  }

  function buildAdminApp() {
    const authenticate = createAuthenticateMiddleware(authRepo);
    const historyService = new DeliveryHistoryService(
      deliveryRepo,
      new InMemoryOrchestrationRepository(),
      new InMemoryBookingRepository(),
      new InMemoryDriverRepository(),
      new InMemoryTrackingRepository(),
      new InMemoryCancellationRepository(),
      new InMemoryOtpRepository(),
      ratingRepo,
      feedbackRepo,
    );
    const deliveryController = new DeliveryController(
      new DeliveryService(deliveryRepo),
      historyService,
    );
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use(
      "/api/v1/admin/deliveries",
      createAdminDeliveryHistoryRouter({
        controller: deliveryController,
        authenticateMiddleware: authenticate,
      }),
    );
    app.use(errorHandlerMiddleware);
    return app;
  }

  it("rejects unauthenticated experience submit", async () => {
    const app = buildCustomerApp();
    const response = await request(app)
      .post("/api/v1/deliveries/00000000-0000-4000-8000-000000000001/experience")
      .send(experienceBody);
    expect(response.status).toBe(401);
  });

  it("submits experience and exposes rating in history", async () => {
    const seeded = await seedDeliveredDelivery({
      deliveryRepo,
      orchestrationRepo: new InMemoryOrchestrationRepository(),
      providerRepo: new InMemoryProviderRepository(),
      bookingRepo: new InMemoryBookingRepository(),
      customerId,
    });
    const app = buildCustomerApp();
    const create = await request(app)
      .post(`/api/v1/deliveries/${seeded.deliveryId}/experience`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send(experienceBody);
    expect(create.status).toBe(201);
    expect(create.body.data.rating.driverRating).toBe(5);

    const history = await request(app)
      .get(`/api/v1/deliveries/${seeded.deliveryId}/history`)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(history.status).toBe(200);
    expect(history.body.data.rating.driverRating).toBe(5);
    expect(history.body.data.feedback.comment).toBe(experienceBody.comment);
  });

  it("rejects customer access to another customer history", async () => {
    const seeded = await seedDeliveredDelivery({
      deliveryRepo,
      orchestrationRepo: new InMemoryOrchestrationRepository(),
      providerRepo: new InMemoryProviderRepository(),
      bookingRepo: new InMemoryBookingRepository(),
      customerId,
    });
    const app = buildCustomerApp();
    const response = await request(app)
      .get(`/api/v1/deliveries/${seeded.deliveryId}/history`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(response.status).toBe(404);
  });

  it("allows admin historical access over HTTP", async () => {
    const seeded = await seedDeliveredDelivery({
      deliveryRepo,
      orchestrationRepo: new InMemoryOrchestrationRepository(),
      providerRepo: new InMemoryProviderRepository(),
      bookingRepo: new InMemoryBookingRepository(),
      customerId,
    });
    const app = buildAdminApp();
    const response = await request(app)
      .get(`/api/v1/admin/deliveries/${seeded.deliveryId}/history`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(response.body.data.delivery.id).toBe(seeded.deliveryId);
  });

  it("rejects customer on admin history endpoint", async () => {
    const seeded = await seedDeliveredDelivery({
      deliveryRepo,
      orchestrationRepo: new InMemoryOrchestrationRepository(),
      providerRepo: new InMemoryProviderRepository(),
      bookingRepo: new InMemoryBookingRepository(),
      customerId,
    });
    const app = buildAdminApp();
    const response = await request(app)
      .get(`/api/v1/admin/deliveries/${seeded.deliveryId}/history`)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(response.status).toBe(403);
  });
});
