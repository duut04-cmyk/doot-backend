import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "../src/config/env.js";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { createAuthenticateMiddleware } from "../src/core/middleware/authenticate.js";
import { errorHandlerMiddleware } from "../src/core/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/core/middleware/request-id.js";
import { generateAccessToken } from "../src/modules/auth/auth.crypto.js";
import { RuntimeSettingsService } from "../src/modules/runtime-settings/runtime-settings.service.js";
import { SettingsController } from "../src/modules/settings/settings.controller.js";
import { SettingsService } from "../src/modules/settings/settings.service.js";
import { createSettingsAdminRouter } from "../src/modules/settings/settings.routes.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";
import { InMemoryRuntimeSettingsRepository } from "./helpers/in-memory-runtime-settings-repository.js";
import { TransactionalStorageFailureRuntimeSettingsRepository } from "./helpers/transactional-storage-failure-runtime-settings-repository.js";

describe("Admin settings HTTP", () => {
  let authRepo: InMemoryAuthRepository;
  let runtimeRepo: InMemoryRuntimeSettingsRepository;
  let customerToken: string;
  let adminToken: string;
  let adminId: string;

  beforeEach(async () => {
    authRepo = new InMemoryAuthRepository();
    runtimeRepo = new InMemoryRuntimeSettingsRepository();

    const customer = await authRepo.createUser({
      name: "Customer",
      email: "customer-settings@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    customer.role = "CUSTOMER";
    customerToken = generateAccessToken(customer.id);

    const admin = await authRepo.createUser({
      name: "Admin",
      email: "admin-settings@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    admin.role = "ADMIN";
    adminId = admin.id;
    adminToken = generateAccessToken(admin.id);
  });

  function buildApp() {
    const runtimeSettings = new RuntimeSettingsService(runtimeRepo);
    const settingsService = new SettingsService(runtimeSettings);
    const controller = new SettingsController(settingsService);
    const authenticate = createAuthenticateMiddleware(authRepo);

    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use(
      "/api/v1/admin/settings",
      createSettingsAdminRouter(controller, authenticate),
    );
    app.use(errorHandlerMiddleware);
    return app;
  }

  it("rejects unauthenticated settings snapshot requests", async () => {
    const app = buildApp();
    expect((await request(app).get("/api/v1/admin/settings")).status).toBe(401);
  });

  it("forbids CUSTOMER from reading settings", async () => {
    const app = buildApp();
    const response = await request(app)
      .get("/api/v1/admin/settings")
      .set("Authorization", `Bearer ${customerToken}`);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it("returns env-backed booking policies with runtime metadata", async () => {
    const app = buildApp();
    const response = await request(app)
      .get("/api/v1/admin/settings")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.policies.booking.quoteMaxAgeSeconds).toBe(
      env.BOOKING_QUOTE_MAX_AGE_SECONDS,
    );
    expect(response.body.data.runtime.booking.quoteMaxAgeSeconds).toEqual({
      value: env.BOOKING_QUOTE_MAX_AGE_SECONDS,
      source: "env",
      version: 0,
      restartRequired: false,
    });
    expect(response.body.data.policies.pricing.platformServiceFeePercent).toBe(
      env.PLATFORM_SERVICE_FEE_PERCENT,
    );
    expect(response.body.data.runtime.pricing.platformServiceFeePercent).toEqual({
      value: env.PLATFORM_SERVICE_FEE_PERCENT,
      source: "env",
      version: 0,
      restartRequired: false,
    });
  });

  it("updates allowlisted booking policies and records audit", async () => {
    const app = buildApp();
    const patchResponse = await request(app)
      .patch("/api/v1/admin/settings/policies")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        booking: { quoteMaxAgeSeconds: 600 },
        expectedVersions: {
          quoteMaxAgeSeconds: 0,
          priceTolerancePercent: 0,
          platformServiceFeePercent: 0,
        },
      });

    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body.data.booking.quoteMaxAgeSeconds).toMatchObject({
      value: 600,
      source: "database",
      version: 1,
      restartRequired: false,
    });
    expect(patchResponse.body.data.audit.outcome).toBe("updated");
    expect(runtimeRepo.auditLogs).toHaveLength(1);
    expect(runtimeRepo.auditLogs[0]?.adminUserId).toBe(adminId);
    expect(runtimeRepo.auditLogs[0]?.action).toBe("PLATFORM_RUNTIME_SETTING_UPDATED");

    const snapshot = await request(app)
      .get("/api/v1/admin/settings")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(snapshot.body.data.policies.booking.quoteMaxAgeSeconds).toBe(600);
    expect(snapshot.body.data.runtime.booking.quoteMaxAgeSeconds.version).toBe(1);
  });

  it("rejects unknown booking policy keys", async () => {
    const app = buildApp();
    const response = await request(app)
      .patch("/api/v1/admin/settings/policies")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        booking: { quoteMaxAgeSeconds: 600, nodeEnv: "production" },
        expectedVersions: {
          quoteMaxAgeSeconds: 0,
          priceTolerancePercent: 0,
          platformServiceFeePercent: 0,
        },
      });
    expect(response.status).toBe(400);
  });

  it("updates allowlisted platform service fee", async () => {
    const app = buildApp();
    const patchResponse = await request(app)
      .patch("/api/v1/admin/settings/policies")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        pricing: { platformServiceFeePercent: 12 },
        expectedVersions: {
          quoteMaxAgeSeconds: 0,
          priceTolerancePercent: 0,
          platformServiceFeePercent: 0,
        },
      });

    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body.data.pricing.platformServiceFeePercent).toMatchObject({
      value: 12,
      source: "database",
      version: 1,
    });
  });

  it("rejects fractional platform service fee values", async () => {
    const app = buildApp();
    const response = await request(app)
      .patch("/api/v1/admin/settings/policies")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        pricing: { platformServiceFeePercent: 10.5 },
        expectedVersions: {
          quoteMaxAgeSeconds: 0,
          priceTolerancePercent: 0,
          platformServiceFeePercent: 0,
        },
      });
    expect(response.status).toBe(400);
  });

  it("rejects invalid numeric bounds", async () => {
    const app = buildApp();
    const response = await request(app)
      .patch("/api/v1/admin/settings/policies")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        booking: { priceTolerancePercent: 150 },
        expectedVersions: {
          quoteMaxAgeSeconds: 0,
          priceTolerancePercent: 0,
          platformServiceFeePercent: 0,
        },
      });
    expect(response.status).toBe(400);
  });

  it("returns conflict when expected version is stale", async () => {
    const app = buildApp();
    await request(app)
      .patch("/api/v1/admin/settings/policies")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        booking: { quoteMaxAgeSeconds: 600 },
        expectedVersions: {
          quoteMaxAgeSeconds: 0,
          priceTolerancePercent: 0,
          platformServiceFeePercent: 0,
        },
      });

    const conflict = await request(app)
      .patch("/api/v1/admin/settings/policies")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        booking: { quoteMaxAgeSeconds: 900 },
        expectedVersions: {
          quoteMaxAgeSeconds: 0,
          priceTolerancePercent: 0,
          platformServiceFeePercent: 0,
        },
      });

    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe(ErrorCodes.CONFLICT);
    expect(runtimeRepo.settings.get("BOOKING_QUOTE_MAX_AGE_SECONDS")?.intValue).toBe(
      600,
    );
  });

  it("rolls back setting changes when audit persistence fails", async () => {
    runtimeRepo.failAuditAfterUpdates = true;
    const app = buildApp();
    const response = await request(app)
      .patch("/api/v1/admin/settings/policies")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        booking: { quoteMaxAgeSeconds: 600 },
        expectedVersions: {
          quoteMaxAgeSeconds: 0,
          priceTolerancePercent: 0,
          platformServiceFeePercent: 0,
        },
      });

    expect(response.status).toBe(500);
    expect(runtimeRepo.settings.size).toBe(0);
    expect(runtimeRepo.auditLogs).toHaveLength(0);
  });

  it("returns 503 when transactional storage read fails instead of a raw persistence error", async () => {
    const failingRepo = new TransactionalStorageFailureRuntimeSettingsRepository();
    failingRepo.findByKeyErrorInTransaction = new Error(
      'invalid input value for enum "PlatformRuntimeSettingKey": "PLATFORM_SERVICE_FEE_PERCENT"',
    );

    const runtimeSettings = new RuntimeSettingsService(failingRepo);
    const settingsService = new SettingsService(runtimeSettings);
    const controller = new SettingsController(settingsService);
    const authenticate = createAuthenticateMiddleware(authRepo);

    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use(
      "/api/v1/admin/settings",
      createSettingsAdminRouter(controller, authenticate),
    );
    app.use(errorHandlerMiddleware);

    const response = await request(app)
      .patch("/api/v1/admin/settings/policies")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        pricing: { platformServiceFeePercent: 12 },
        expectedVersions: {
          quoteMaxAgeSeconds: 0,
          priceTolerancePercent: 0,
          platformServiceFeePercent: 0,
        },
      });

    expect(response.status).toBe(503);
    expect(response.body.error.message).toContain("Apply database migrations");
    expect(failingRepo.createSettingCallCount).toBe(0);
    expect(failingRepo.settings.size).toBe(0);
  });
});
