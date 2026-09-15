import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { createAuthenticateMiddleware } from "../src/core/middleware/authenticate.js";
import { errorHandlerMiddleware } from "../src/core/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/core/middleware/request-id.js";
import { validateRequest } from "../src/core/validation/index.js";
import { generateAccessToken } from "../src/modules/auth/auth.crypto.js";
import { DeliveryController } from "../src/modules/delivery/delivery.controller.js";
import {
  createDeliverySchema,
  deliveryIdParamsSchema,
  listDeliveriesQuerySchema,
} from "../src/modules/delivery/delivery.schema.js";
import { DeliveryService } from "../src/modules/delivery/delivery.service.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";

function futureWindow(hoursFromNow = 24) {
  const start = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  return {
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
  };
}

function basePayload(overrides?: Record<string, unknown>) {
  return {
    pickup: {
      addressText: "12 MG Road, Bengaluru",
      contactName: "Riya Sharma",
      contactPhone: "+919876543210",
      instructions: "Gate 2",
    },
    drop: {
      addressText: "88 Indiranagar, Bengaluru",
      contactName: "Aman Verma",
      contactPhone: "+919811122233",
      instructions: null,
    },
    package: {
      packageType: "FOOD",
      description: "Fresh meal",
      weightKg: 1.8,
      sizeTier: "MEDIUM",
      quantity: 1,
      photos: [
        {
          objectKey: "deliveries/tmp/photos/front.jpg",
          storageProvider: "PENDING",
          mimeType: "image/jpeg",
          fileSizeBytes: 12000,
        },
      ],
    },
    requirements: ["HANDLE_WITH_CARE"],
    specialInstructions: "Please call before arrival.",
    schedule: {
      mode: "ASAP",
      timezone: "Asia/Kolkata",
    },
    compliance: {
      accepted: true,
    },
    ...overrides,
  };
}

describe("Delivery Phase 1 foundation", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let authRepo: InMemoryAuthRepository;
  let service: DeliveryService;
  let customerId: string;
  let otherCustomerId: string;

  beforeEach(async () => {
    deliveryRepo = new InMemoryDeliveryRepository();
    authRepo = new InMemoryAuthRepository();
    service = new DeliveryService(deliveryRepo);

    const customer = await authRepo.createUser({
      name: "Customer One",
      email: "customer1@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    customer.role = "CUSTOMER";
    customerId = customer.id;

    const other = await authRepo.createUser({
      name: "Customer Two",
      email: "customer2@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    other.role = "CUSTOMER";
    otherCustomerId = other.id;
  });

  function buildApp() {
    const controller = new DeliveryController(service);
    const authenticate = createAuthenticateMiddleware(authRepo);
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    const router = express.Router();
    router.post(
      "/",
      authenticate,
      validateRequest({ body: createDeliverySchema }),
      controller.create,
    );
    router.get(
      "/",
      authenticate,
      validateRequest({ query: listDeliveriesQuerySchema }),
      controller.list,
    );
    router.get(
      "/:id",
      authenticate,
      validateRequest({ params: deliveryIdParamsSchema }),
      controller.getById,
    );
    app.use("/api/v1/deliveries", router);
    app.use(errorHandlerMiddleware);
    return app;
  }

  describe("creation", () => {
    it("creates a valid ASAP delivery in CREATED with status event and reference", async () => {
      const result = await service.createDelivery({
        customerId,
        body: createDeliverySchema.parse(basePayload()),
        idempotencyKey: "key-asap-1",
      });

      expect(result.data.status).toBe("CREATED");
      expect(result.data.reference).toMatch(/^DUTT-\d+$/);
      expect(result.data.package.sizeTier).toBe("MEDIUM");
      expect(result.data.compliance.accepted).toBe(true);
      expect(result.data.compliance.acceptedAt).toBeTruthy();
      expect(deliveryRepo.deliveries[0]?.statusEvents[0]?.toStatus).toBe("CREATED");
      expect(deliveryRepo.deliveries[0]?.statusEvents[0]?.fromStatus).toBeNull();
    });

    it("creates scheduled medicine/food/document/other packages", async () => {
      const window = futureWindow();
      for (const [packageType, weightKg, description] of [
        ["MEDICINE", 0.5, null],
        ["FOOD", 2.0, "Lunch"],
        ["DOCUMENT", 0.2, null],
        ["OTHER", 1.2, "Spare parts"],
      ] as const) {
        const result = await service.createDelivery({
          customerId,
          body: createDeliverySchema.parse(
            basePayload({
              package: {
                packageType,
                description,
                weightKg,
                quantity: 1,
                photos: [],
              },
              schedule: {
                mode: "SCHEDULED",
                timezone: "Asia/Kolkata",
                ...window,
              },
            }),
          ),
          idempotencyKey: `key-${packageType}`,
        });
        expect(result.data.package.packageType).toBe(packageType);
        expect(result.data.schedule.mode).toBe("SCHEDULED");
        expect(result.data.schedule.windowStart).toBeTruthy();
      }
    });

    it("allows light and medium packages without dimensions; requires dims above 3kg", async () => {
      const light = await service.createDelivery({
        customerId,
        body: createDeliverySchema.parse(
          basePayload({
            package: { packageType: "DOCUMENT", weightKg: 0.8, photos: [] },
          }),
        ),
        idempotencyKey: "light",
      });
      expect(light.data.package.sizeTier).toBe("SMALL");
      expect(light.data.package.lengthCm).toBeNull();

      const medium = await service.createDelivery({
        customerId,
        body: createDeliverySchema.parse(
          basePayload({
            package: { packageType: "FOOD", weightKg: 2.5, photos: [] },
          }),
        ),
        idempotencyKey: "medium",
      });
      expect(medium.data.package.sizeTier).toBe("MEDIUM");

      expect(() =>
        createDeliverySchema.parse(
          basePayload({
            package: { packageType: "OTHER", description: "Box", weightKg: 4.5, photos: [] },
          }),
        ),
      ).toThrow();

      const heavy = await service.createDelivery({
        customerId,
        body: createDeliverySchema.parse(
          basePayload({
            package: {
              packageType: "OTHER",
              description: "Box",
              weightKg: 4.5,
              lengthCm: 20,
              widthCm: 15,
              heightCm: 10,
              photos: [],
            },
          }),
        ),
        idempotencyKey: "heavy",
      });
      expect(heavy.data.package.sizeTier).toBe("LARGE");
    });

    it("normalizes NONE requirements and rejects client-owned fields via schema shape", async () => {
      const parsed = createDeliverySchema.parse(
        basePayload({
          requirements: ["NONE", "FRAGILE", "NONE", "FRAGILE"],
        }),
      );
      expect(parsed.requirements).toEqual(["FRAGILE"]);

      const result = await service.createDelivery({
        customerId,
        body: parsed,
        idempotencyKey: "req-none",
      });
      expect(result.data.requirements).toEqual(["FRAGILE"]);
      expect(result.data).not.toHaveProperty("customerId");
    });
  });

  describe("validation failures", () => {
    it("rejects invalid phones, weights, dimensions, schedule, compliance, photos", () => {
      expect(() =>
        createDeliverySchema.parse(
          basePayload({
            pickup: {
              addressText: "A",
              contactName: "B",
              contactPhone: "9876543210",
            },
          }),
        ),
      ).toThrow();

      expect(() =>
        createDeliverySchema.parse(
          basePayload({
            package: { packageType: "FOOD", weightKg: 0, photos: [] },
          }),
        ),
      ).toThrow();

      expect(() =>
        createDeliverySchema.parse(
          basePayload({
            package: { packageType: "FOOD", weightKg: -1, photos: [] },
          }),
        ),
      ).toThrow();

      expect(() =>
        createDeliverySchema.parse(
          basePayload({
            package: {
              packageType: "FOOD",
              weightKg: 4.5,
              lengthCm: 20,
              widthCm: 15,
              photos: [],
            },
          }),
        ),
      ).toThrow();

      expect(() =>
        createDeliverySchema.parse(
          basePayload({
            package: {
              packageType: "FOOD",
              weightKg: 2,
              lengthCm: 0,
              widthCm: 10,
              heightCm: 10,
              photos: [],
            },
          }),
        ),
      ).toThrow();

      expect(() =>
        createDeliverySchema.parse(
          basePayload({
            package: {
              packageType: "OTHER",
              description: "   ",
              weightKg: 1,
              photos: [],
            },
          }),
        ),
      ).toThrow();

      expect(() =>
        createDeliverySchema.parse(
          basePayload({
            package: {
              packageType: "FOOD",
              weightKg: 1,
              sizeTier: "LARGE",
              photos: [],
            },
          }),
        ),
      ).toThrow();

      expect(() =>
        createDeliverySchema.parse(
          basePayload({
            schedule: { mode: "ASAP", timezone: "Not/AZone" },
          }),
        ),
      ).toThrow();

      expect(() =>
        createDeliverySchema.parse(
          basePayload({
            schedule: {
              mode: "SCHEDULED",
              timezone: "Asia/Kolkata",
              windowStart: new Date(Date.now() - 3600_000).toISOString(),
              windowEnd: new Date(Date.now() + 3600_000).toISOString(),
            },
          }),
        ),
      ).toThrow();

      expect(() =>
        createDeliverySchema.parse(basePayload({ compliance: { accepted: false } })),
      ).toThrow();

      expect(() =>
        createDeliverySchema.parse(
          basePayload({
            package: {
              packageType: "FOOD",
              weightKg: 1,
              photos: [{ objectKey: "blob:http://localhost/abc" }],
            },
          }),
        ),
      ).toThrow();

      expect(() =>
        createDeliverySchema.parse(
          basePayload({
            package: {
              packageType: "FOOD",
              weightKg: 1,
              photos: [{ objectKey: "https://cdn.example.com/a.jpg" }],
            },
          }),
        ),
      ).toThrow();

      expect(() =>
        createDeliverySchema.parse(
          basePayload({ requirements: ["TEMPERATURE_CONTROLLED"] }),
        ),
      ).toThrow();
    });
  });

  describe("idempotency", () => {
    it("returns the same delivery for identical retries", async () => {
      const body = createDeliverySchema.parse(basePayload());
      const first = await service.createDelivery({
        customerId,
        body,
        idempotencyKey: "same-key",
      });
      const second = await service.createDelivery({
        customerId,
        body,
        idempotencyKey: "same-key",
      });
      expect(second.data.id).toBe(first.data.id);
      expect(deliveryRepo.deliveries).toHaveLength(1);
    });

    it("conflicts when the same key is reused with a different payload", async () => {
      const body = createDeliverySchema.parse(basePayload());
      await service.createDelivery({
        customerId,
        body,
        idempotencyKey: "conflict-key",
      });

      await expect(
        service.createDelivery({
          customerId,
          body: createDeliverySchema.parse(
            basePayload({
              specialInstructions: "Different",
            }),
          ),
          idempotencyKey: "conflict-key",
        }),
      ).rejects.toMatchObject({ code: ErrorCodes.IDEMPOTENCY_CONFLICT });
    });

    it("allows different customers to reuse the same idempotency key", async () => {
      const body = createDeliverySchema.parse(basePayload());
      const a = await service.createDelivery({
        customerId,
        body,
        idempotencyKey: "shared-key",
      });
      const b = await service.createDelivery({
        customerId: otherCustomerId,
        body,
        idempotencyKey: "shared-key",
      });
      expect(a.data.id).not.toBe(b.data.id);
      expect(deliveryRepo.deliveries).toHaveLength(2);
    });
  });

  describe("transaction rollback", () => {
    it("does not leave a partial delivery when create fails", async () => {
      deliveryRepo.failOnNextCreate();
      await expect(
        service.createDelivery({
          customerId,
          body: createDeliverySchema.parse(basePayload()),
          idempotencyKey: "tx-fail",
        }),
      ).rejects.toThrow(/simulated create failure/);
      expect(deliveryRepo.deliveries).toHaveLength(0);
      expect(deliveryRepo.idempotency).toHaveLength(0);
    });
  });

  describe("authorization & http", () => {
    it("rejects unauthenticated create/list/detail", async () => {
      const app = buildApp();
      expect((await request(app).post("/api/v1/deliveries").send(basePayload())).status).toBe(
        401,
      );
      expect((await request(app).get("/api/v1/deliveries")).status).toBe(401);
      expect(
        (await request(app).get(`/api/v1/deliveries/${randomUUID()}`)).status,
      ).toBe(401);
    });

    it("enforces ownership and lists only own deliveries", async () => {
      const app = buildApp();
      const token = generateAccessToken(customerId);
      const otherToken = generateAccessToken(otherCustomerId);

      const created = await request(app)
        .post("/api/v1/deliveries")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", "http-create-1")
        .send(basePayload());
      expect(created.status).toBe(201);
      expect(created.body.data.reference).toMatch(/^DUTT-\d+$/);
      expect(created.body.data.status).toBe("CREATED");
      expect(deliveryRepo.deliveries).toHaveLength(1);
      expect(deliveryRepo.deliveries[0]?.customerId).toBe(customerId);

      const listOwn = await request(app)
        .get("/api/v1/deliveries")
        .set("Authorization", `Bearer ${token}`);
      expect(listOwn.status).toBe(200);
      expect(listOwn.body).toMatchObject({
        success: true,
        data: { total: 1 },
      });
      expect(listOwn.body.data.items).toHaveLength(1);

      const listOther = await request(app)
        .get("/api/v1/deliveries")
        .set("Authorization", `Bearer ${otherToken}`);
      expect(listOther.status).toBe(200);
      expect(listOther.body.data.items).toHaveLength(0);

      const forbidden = await request(app)
        .get(`/api/v1/deliveries/${created.body.data.id}`)
        .set("Authorization", `Bearer ${otherToken}`);
      expect(forbidden.status).toBe(404);
      expect(forbidden.body.error.code).toBe(ErrorCodes.DELIVERY_NOT_FOUND);

      const detail = await request(app)
        .get(`/api/v1/deliveries/${created.body.data.id}`)
        .set("Authorization", `Bearer ${token}`);
      expect(detail.status).toBe(200);
      expect(detail.body.data.id).toBe(created.body.data.id);
    });

    it("requires Idempotency-Key on create", async () => {
      const app = buildApp();
      const token = generateAccessToken(customerId);
      const res = await request(app)
        .post("/api/v1/deliveries")
        .set("Authorization", `Bearer ${token}`)
        .send(basePayload());
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(ErrorCodes.IDEMPOTENCY_KEY_REQUIRED);
    });

    it("allocates unique references across multiple creations", async () => {
      const refs = new Set<string>();
      for (let i = 0; i < 5; i++) {
        const result = await service.createDelivery({
          customerId,
          body: createDeliverySchema.parse(basePayload()),
          idempotencyKey: `ref-${i}`,
        });
        refs.add(result.data.reference);
      }
      expect(refs.size).toBe(5);
    });
  });
});
