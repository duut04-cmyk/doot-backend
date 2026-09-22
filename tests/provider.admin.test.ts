import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { createAuthenticateMiddleware } from "../src/core/middleware/authenticate.js";
import { errorHandlerMiddleware } from "../src/core/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/core/middleware/request-id.js";
import { generateAccessToken } from "../src/modules/auth/auth.crypto.js";
import { decryptCredential } from "../src/modules/provider/provider.crypto.js";
import { ProviderController } from "../src/modules/provider/provider.controller.js";
import { createProviderAdminRouter } from "../src/modules/provider/provider.routes.js";
import { createProviderSchema } from "../src/modules/provider/provider.schema.js";
import { ProviderService } from "../src/modules/provider/provider.service.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";

describe("Provider Phase 2 admin configuration", () => {
  let providerRepo: InMemoryProviderRepository;
  let authRepo: InMemoryAuthRepository;
  let service: ProviderService;
  let adminId: string;
  let customerId: string;

  beforeEach(async () => {
    providerRepo = new InMemoryProviderRepository();
    authRepo = new InMemoryAuthRepository();
    service = new ProviderService(providerRepo);

    const admin = await authRepo.createUser({
      name: "Admin User",
      email: "admin@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    admin.role = "ADMIN";
    adminId = admin.id;

    const customer = await authRepo.createUser({
      name: "Customer User",
      email: "customer@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    customer.role = "CUSTOMER";
    customerId = customer.id;
  });

  function tokenFor(userId: string) {
    return generateAccessToken(userId);
  }

  function buildApp(testService: ProviderService = service) {
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    const authenticate = createAuthenticateMiddleware(authRepo);
    app.use(
      "/api/v1/admin/providers",
      createProviderAdminRouter(new ProviderController(testService), authenticate),
    );
    app.use(errorHandlerMiddleware);
    return app;
  }

  async function createProviderViaService(overrides?: Record<string, unknown>) {
    const body = createProviderSchema.parse({
      code: "MOCK",
      name: "Mock Provider",
      environment: "SANDBOX",
      enabled: false,
      capabilities: ["SERVICEABILITY", "BOOKING"],
      ...overrides,
    });
    return service.createProvider({
      body,
      audit: { adminUserId: adminId, requestId: "req-create" },
    });
  }

  describe("authorization", () => {
    it("returns 401 when unauthenticated", async () => {
      const app = buildApp();
      const response = await request(app).get("/api/v1/admin/providers");
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe(ErrorCodes.UNAUTHORIZED);
    });

    it("returns 403 for CUSTOMER role", async () => {
      const app = buildApp();
      const response = await request(app)
        .get("/api/v1/admin/providers")
        .set("Authorization", `Bearer ${tokenFor(customerId)}`);
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe(ErrorCodes.FORBIDDEN);
    });

    it("allows ADMIN role", async () => {
      await createProviderViaService();
      const app = buildApp();
      const response = await request(app)
        .get("/api/v1/admin/providers")
        .set("Authorization", `Bearer ${tokenFor(adminId)}`);
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
    });
  });

  describe("provider CRUD", () => {
    it("creates a provider and rejects duplicate code", async () => {
      const created = await createProviderViaService();
      expect(created.data.code).toBe("MOCK");
      expect(created.data.integrationStatus).toBe("NOT_CONFIGURED");
      expect(created.data.orchestrationEligible).toBe(false);

      await expect(
        createProviderViaService({ code: "MOCK", name: "Duplicate" }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: ErrorCodes.PROVIDER_CODE_ALREADY_EXISTS,
      });
    });

    it("lists and gets provider by id", async () => {
      const created = await createProviderViaService();
      const list = await service.listProviders();
      expect(list.data).toHaveLength(1);

      const detail = await service.getProvider(created.data.id);
      expect(detail.data.code).toBe("MOCK");
      expect(detail.data.settings.timeoutMs).toBe(30000);
    });

    it("updates provider fields and priority", async () => {
      const created = await createProviderViaService();
      const updated = await service.updateProvider({
        providerId: created.data.id,
        body: { priority: 5, orchestrationEnabled: true },
        audit: { adminUserId: adminId, requestId: "req-update" },
      });
      expect(updated.data.priority).toBe(5);
      expect(updated.data.orchestrationEnabled).toBe(true);
    });

    it("updates status and enable/disable lifecycle", async () => {
      const created = await createProviderViaService({ enabled: false });
      const activated = await service.updateProviderStatus({
        providerId: created.data.id,
        body: { status: "ACTIVE" },
        audit: { adminUserId: adminId, requestId: "req-status" },
      });
      expect(activated.data.status).toBe("ACTIVE");
      expect(activated.data.enabled).toBe(true);

      const suspended = await service.updateProviderStatus({
        providerId: created.data.id,
        body: { status: "SUSPENDED", enabled: false },
        audit: { adminUserId: adminId, requestId: "req-suspend" },
      });
      expect(suspended.data.status).toBe("SUSPENDED");
      expect(suspended.data.enabled).toBe(false);
    });

    it("returns 404 for unknown provider id", async () => {
      await expect(service.getProvider(randomUUID())).rejects.toMatchObject({
        statusCode: 404,
        code: ErrorCodes.PROVIDER_NOT_FOUND,
      });
    });
  });

  describe("capabilities", () => {
    it("replaces capabilities via controlled enum", async () => {
      const created = await createProviderViaService();
      const updated = await service.replaceCapabilities({
        providerId: created.data.id,
        body: { capabilities: ["PRICING", "BOOKING"] },
        audit: { adminUserId: adminId, requestId: "req-cap" },
      });
      expect(updated.data.capabilities).toEqual(["PRICING", "BOOKING"]);
    });
  });

  describe("services", () => {
    it("creates, lists, updates, and disables services", async () => {
      const created = await createProviderViaService();
      const serviceCreated = await service.createService({
        providerId: created.data.id,
        body: {
          code: "BIKE_EXPRESS",
          name: "Bike Express",
          serviceType: "BIKE",
        },
        audit: { adminUserId: adminId, requestId: "req-svc" },
      });
      expect(serviceCreated.data.code).toBe("BIKE_EXPRESS");

      await expect(
        service.createService({
          providerId: created.data.id,
          body: {
            code: "BIKE_EXPRESS",
            name: "Duplicate",
            serviceType: "BIKE",
          },
          audit: { adminUserId: adminId, requestId: "req-dup" },
        }),
      ).rejects.toMatchObject({ statusCode: 409 });

      const list = await service.listServices(created.data.id);
      expect(list.data).toHaveLength(1);

      const disabled = await service.updateService({
        providerId: created.data.id,
        serviceId: serviceCreated.data.id,
        body: { enabled: false },
        audit: { adminUserId: adminId, requestId: "req-disable" },
      });
      expect(disabled.data.enabled).toBe(false);
    });
  });

  describe("vehicles", () => {
    it("creates and updates vehicles with limits", async () => {
      const created = await createProviderViaService();
      const vehicle = await service.createVehicle({
        providerId: created.data.id,
        body: { vehicleType: "BIKE", maxWeightKg: 10 },
        audit: { adminUserId: adminId, requestId: "req-veh" },
      });
      expect(vehicle.data.vehicleType).toBe("BIKE");
      expect(vehicle.data.maxWeightKg).toBe(10);

      await expect(
        service.createVehicle({
          providerId: created.data.id,
          body: { vehicleType: "BIKE" },
          audit: { adminUserId: adminId, requestId: "req-dup-veh" },
        }),
      ).rejects.toMatchObject({ statusCode: 409 });
    });
  });

  describe("credentials", () => {
    it("encrypts credentials and never exposes secrets in GET", async () => {
      const created = await createProviderViaService({ enabled: true });
      const secret = "super-secret-api-key-value";
      const upsert = await service.upsertCredentials({
        providerId: created.data.id,
        body: { API_KEY: secret },
        audit: { adminUserId: adminId, requestId: "req-cred" },
      });
      expect(upsert.data.configured).toBe(true);

      const stored = providerRepo.providers[0]?.credentials.find(
        (item) => item.isActive && item.fieldName === "API_KEY",
      );
      expect(stored).toBeTruthy();
      expect(stored?.ciphertext).not.toBe(secret);

      const decrypted = decryptCredential({
        ciphertext: stored!.ciphertext,
        iv: stored!.iv,
        authTag: stored!.authTag,
      });
      expect(decrypted).toBe(secret);

      const detail = await service.getProvider(created.data.id);
      const serialized = JSON.stringify(detail);
      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain(stored!.ciphertext);
      expect(detail.data.credentials.configured).toBe(true);
      expect(
        detail.data.credentials.fields.find((f) => f.name === "API_KEY")?.configured,
      ).toBe(true);
    });

    it("credential PUT response does not echo secrets", async () => {
      const created = await createProviderViaService();
      const app = buildApp();
      const secret = "another-secret-value-12345";
      const response = await request(app)
        .put(`/api/v1/admin/providers/${created.data.id}/credentials`)
        .set("Authorization", `Bearer ${tokenFor(adminId)}`)
        .send({ API_KEY: secret });

      expect(response.status).toBe(200);
      expect(JSON.stringify(response.body)).not.toContain(secret);
      expect(response.body.data.configured).toBe(true);
    });
  });

  describe("readiness", () => {
    it("remains NOT_CONFIGURED without credentials even when enabled", async () => {
      const created = await createProviderViaService({ enabled: true });
      expect(created.data.integrationStatus).toBe("NOT_CONFIGURED");
      expect(created.data.orchestrationEligible).toBe(false);
    });

    it("becomes CONFIGURED when enabled with credentials and capabilities", async () => {
      const created = await createProviderViaService({ enabled: true });
      await service.upsertCredentials({
        providerId: created.data.id,
        body: { API_KEY: "key" },
        audit: { adminUserId: adminId, requestId: "req-ready" },
      });
      const detail = await service.getProvider(created.data.id);
      expect(detail.data.integrationStatus).toBe("CONFIGURED");
      expect(detail.data.orchestrationEligible).toBe(false);
    });

    it("promotes to READY with HEALTHY after successful connection test", async () => {
      const { initializeProviderAdapters } =
        await import("../src/modules/provider/adapters/bootstrap.js");
      initializeProviderAdapters();

      const created = await createProviderViaService({
        enabled: true,
        orchestrationEnabled: true,
      });
      await service.upsertCredentials({
        providerId: created.data.id,
        body: { API_KEY: "key" },
        audit: { adminUserId: adminId, requestId: "req-health-cred" },
      });
      await service.recordConnectionTestResult({
        providerId: created.data.id,
        connected: true,
        audit: { adminUserId: adminId, requestId: "req-health" },
      });
      const detail = await service.getProvider(created.data.id);
      expect(detail.data.health.status).toBe("HEALTHY");
      expect(detail.data.integrationStatus).toBe("READY");
      expect(detail.data.orchestrationEligible).toBe(true);
    });

    it("disabled provider is NOT configured for orchestration", async () => {
      const created = await createProviderViaService({ enabled: true });
      await service.upsertCredentials({
        providerId: created.data.id,
        body: { API_KEY: "key" },
        audit: { adminUserId: adminId, requestId: "req-cred2" },
      });
      await service.updateProvider({
        providerId: created.data.id,
        body: { enabled: false },
        audit: { adminUserId: adminId, requestId: "req-off" },
      });
      const detail = await service.getProvider(created.data.id);
      expect(detail.data.integrationStatus).toBe("NOT_CONFIGURED");
      expect(detail.data.orchestrationEligible).toBe(false);
    });
  });

  describe("audit", () => {
    it("records safe audit metadata without secrets", async () => {
      const created = await createProviderViaService();
      await service.upsertCredentials({
        providerId: created.data.id,
        body: { API_KEY: "audit-secret-should-not-appear" },
        audit: { adminUserId: adminId, requestId: "req-audit-cred" },
      });
      await service.updateProvider({
        providerId: created.data.id,
        body: { priority: 20 },
        audit: { adminUserId: adminId, requestId: "req-audit-upd" },
      });

      expect(providerRepo.auditLogs.length).toBeGreaterThanOrEqual(3);
      const serialized = JSON.stringify(providerRepo.auditLogs);
      expect(serialized).not.toContain("audit-secret-should-not-appear");
      expect(
        providerRepo.auditLogs.some((log) => log.action === "PROVIDER_CREATED"),
      ).toBe(true);
      expect(
        providerRepo.auditLogs.some(
          (log) => log.action === "PROVIDER_CREDENTIALS_UPDATED",
        ),
      ).toBe(true);
      expect(providerRepo.auditLogs.every((log) => log.requestId.length > 0)).toBe(
        true,
      );
    });
  });

  describe("HTTP validation", () => {
    it("rejects invalid capability strings at the HTTP layer", async () => {
      const created = await createProviderViaService();
      const app = buildApp();
      const response = await request(app)
        .put(`/api/v1/admin/providers/${created.data.id}/capabilities`)
        .set("Authorization", `Bearer ${tokenFor(adminId)}`)
        .send({ capabilities: ["NOT_A_REAL_CAPABILITY"] });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it("rejects invalid provider id", async () => {
      const app = buildApp();
      const response = await request(app)
        .get("/api/v1/admin/providers/not-a-uuid")
        .set("Authorization", `Bearer ${tokenFor(adminId)}`);
      expect(response.status).toBe(400);
    });
  });
});
