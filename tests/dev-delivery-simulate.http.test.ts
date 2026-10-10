import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuthenticateMiddleware } from "../src/core/middleware/authenticate.js";
import { errorHandlerMiddleware } from "../src/core/middleware/error-handler.js";
import { notFoundMiddleware } from "../src/core/middleware/not-found.js";
import { requestIdMiddleware } from "../src/core/middleware/request-id.js";
import { generateAccessToken } from "../src/modules/auth/auth.crypto.js";
import { DeliveryLifecycleService } from "../src/modules/delivery/delivery-lifecycle.service.js";
import { DevDeliverySimulateController } from "../src/modules/dev-delivery-simulate/dev-delivery-simulate.controller.js";
import { DevDeliverySimulateService } from "../src/modules/dev-delivery-simulate/dev-delivery-simulate.service.js";
import { DriverController } from "../src/modules/driver/driver.controller.js";
import { DriverService } from "../src/modules/driver/driver.service.js";
import { createOperationalRouter } from "../src/modules/operations/operational.routes.js";
import { TrackingService } from "../src/modules/tracking/tracking.service.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryDriverRepository } from "./helpers/in-memory-driver-repository.js";
import { InMemoryOtpRepository } from "./helpers/in-memory-otp-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { InMemoryTrackingRepository } from "./helpers/in-memory-tracking-repository.js";
import { seedBookedDelivery } from "./helpers/operational-test-helpers.js";

describe("Dev delivery simulate HTTP", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let bookingRepo: InMemoryBookingRepository;
  let driverRepo: InMemoryDriverRepository;
  let orchestrationRepo: InMemoryOrchestrationRepository;
  let providerRepo: InMemoryProviderRepository;
  let authRepo: InMemoryAuthRepository;
  let otpRepo: InMemoryOtpRepository;
  let trackingRepo: InMemoryTrackingRepository;
  let customerId: string;
  let customerToken: string;

  beforeEach(async () => {
    process.env.ENABLE_DEV_DELIVERY_SIMULATE = "true";
    deliveryRepo = new InMemoryDeliveryRepository();
    bookingRepo = new InMemoryBookingRepository();
    driverRepo = new InMemoryDriverRepository();
    orchestrationRepo = new InMemoryOrchestrationRepository();
    providerRepo = new InMemoryProviderRepository();
    authRepo = new InMemoryAuthRepository();
    otpRepo = new InMemoryOtpRepository();
    trackingRepo = new InMemoryTrackingRepository();

    const customer = await authRepo.createUser({
      name: "Customer",
      email: "dev-sim-customer@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    customer.role = "CUSTOMER";
    customerId = customer.id;
    customerToken = generateAccessToken(customerId);
  });

  function buildApp(options?: { enableDevDeliverySimulate?: boolean }) {
    const lifecycle = new DeliveryLifecycleService(deliveryRepo);
    const driverService = new DriverService(
      deliveryRepo,
      bookingRepo,
      driverRepo,
      lifecycle,
    );
    const trackingService = new TrackingService(deliveryRepo, trackingRepo, lifecycle);
    const devSimulateService = new DevDeliverySimulateService(
      deliveryRepo,
      bookingRepo,
      lifecycle,
      driverService,
      otpRepo,
      trackingService,
    );
    const authenticate = createAuthenticateMiddleware(authRepo);

    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use(
      "/api/v1/deliveries",
      createOperationalRouter({
        driverController: new DriverController(driverService),
        devDeliverySimulateController: new DevDeliverySimulateController(
          devSimulateService,
        ),
        authenticateMiddleware: authenticate,
        enableDevDeliverySimulate: options?.enableDevDeliverySimulate ?? true,
      }),
    );
    app.use(notFoundMiddleware);
    app.use(errorHandlerMiddleware);
    return app;
  }

  it("walks a MOCK delivery through delivered via repeated advance calls", async () => {
    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });
    const app = buildApp();
    const path = `/api/v1/deliveries/${seeded.deliveryId}/dev/advance`;

    const steps: string[] = [];
    let status = "BOOKED";

    for (let i = 0; i < 8; i += 1) {
      const res = await request(app)
        .post(path)
        .set("Authorization", `Bearer ${customerToken}`);
      expect(res.status).toBe(200);
      steps.push(res.body.data.step);
      status = res.body.data.status;
      if (status === "DELIVERED") {
        break;
      }
    }

    expect(steps).toEqual([
      "ASSIGN_DRIVER",
      "ISSUE_PICKUP_OTP",
      "CONFIRM_PICKUP",
      "START_TRANSIT",
      "ISSUE_DELIVERY_OTP",
      "CONFIRM_DELIVERY",
    ]);
    expect(status).toBe("DELIVERED");
  });

  it("returns 404 when simulation route is disabled", async () => {
    const app = buildApp({ enableDevDeliverySimulate: false });

    const res = await request(app)
      .post(`/api/v1/deliveries/00000000-0000-4000-8000-000000000001/dev/advance`)
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(404);
  });
});
