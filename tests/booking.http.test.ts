import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { createAuthenticateMiddleware } from "../src/core/middleware/authenticate.js";
import { errorHandlerMiddleware } from "../src/core/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/core/middleware/request-id.js";
import { validateRequest } from "../src/core/validation/index.js";
import { generateAccessToken } from "../src/modules/auth/auth.crypto.js";
import { BookingController } from "../src/modules/booking/booking.controller.js";
import { confirmDeliveryBodySchema } from "../src/modules/booking/booking.schema.js";
import { BookingService } from "../src/modules/booking/booking.service.js";
import { deliveryIdParamsSchema } from "../src/modules/delivery/delivery.schema.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";
import { seedOptionReadyDelivery } from "./helpers/booking-test-helpers.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { initializeProviderAdapters } from "../src/modules/provider/adapters/bootstrap.js";
import { ProviderAdapterExecutor } from "../src/modules/provider/adapters/provider-adapter-executor.js";
import { knownFixedFeeCancellationPolicy } from "./helpers/cancellation-policy-test-helpers.js";

describe("Booking HTTP", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let providerRepo: InMemoryProviderRepository;
  let orchestrationRepo: InMemoryOrchestrationRepository;
  let bookingRepo: InMemoryBookingRepository;
  let authRepo: InMemoryAuthRepository;
  let customerId: string;
  let token: string;
  let executeMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    initializeProviderAdapters();
    deliveryRepo = new InMemoryDeliveryRepository();
    providerRepo = new InMemoryProviderRepository();
    orchestrationRepo = new InMemoryOrchestrationRepository();
    bookingRepo = new InMemoryBookingRepository();
    authRepo = new InMemoryAuthRepository();
    executeMock = vi.fn();
    const customer = await authRepo.createUser({
      name: "Customer",
      email: "booking@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    customer.role = "CUSTOMER";
    customerId = customer.id;
    token = generateAccessToken(customerId);
  });

  function buildApp() {
    const executor = {
      execute: executeMock,
    } as unknown as ProviderAdapterExecutor;
    const service = new BookingService(
      deliveryRepo,
      providerRepo,
      orchestrationRepo,
      bookingRepo,
      executor,
    );
    const controller = new BookingController(service);
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use(createAuthenticateMiddleware(authRepo));
    app.post(
      "/api/v1/deliveries/:id/confirm",
      validateRequest({
        params: deliveryIdParamsSchema,
        body: confirmDeliveryBodySchema,
      }),
      controller.confirm,
    );
    app.get(
      "/api/v1/deliveries/:id/booking",
      validateRequest({ params: deliveryIdParamsSchema }),
      controller.getBooking,
    );
    app.use(errorHandlerMiddleware);
    return app;
  }

  it("returns 401 without auth on confirm", async () => {
    const app = buildApp();
    const res = await request(app)
      .post(`/api/v1/deliveries/${randomUUID()}/confirm`)
      .send({});
    expect(res.status).toBe(401);
  });

  it("confirms delivery via HTTP and returns booking payload", async () => {
    executeMock.mockImplementation(async (input: { operation: string }) => {
      if (input.operation === "getCancellationPolicy") {
        return knownFixedFeeCancellationPolicy();
      }
      return {
        success: true,
        outcome: "BOOKED",
        providerBookingId: "PO-HTTP-1",
        providerReference: "REF-HTTP-1",
        status: "CONFIRMED",
        bookedAt: new Date().toISOString(),
        estimatedPickupAt: null,
        estimatedDeliveryAt: null,
        trackingUrl: null,
        driver: null,
        service: null,
        reason: null,
        amount: { amount: 150, currency: "INR" },
      };
    });

    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
    });

    const app = buildApp();
    const res = await request(app)
      .post(`/api/v1/deliveries/${seeded.deliveryId}/confirm`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", randomUUID())
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.delivery.status).toBe("BOOKED");
    expect(res.body.data.booking.status).toBe("BOOKED");
    expect(res.body.data.booking.providerCode).toBe("MOCK");
    expect(JSON.stringify(res.body)).not.toMatch(/api-key|secret|credential/i);
  });

  it("returns 404 for cross-customer GET booking", async () => {
    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
    });
    const other = await authRepo.createUser({
      name: "Other",
      email: "other@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    other.role = "CUSTOMER";
    const otherToken = generateAccessToken(other.id);

    const app = buildApp();
    const res = await request(app)
      .get(`/api/v1/deliveries/${seeded.deliveryId}/booking`)
      .set("Authorization", `Bearer ${otherToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(ErrorCodes.DELIVERY_NOT_FOUND);
  });
});
