import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { createAuthenticateMiddleware } from "../src/core/middleware/authenticate.js";
import { errorHandlerMiddleware } from "../src/core/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/core/middleware/request-id.js";
import { generateAccessToken } from "../src/modules/auth/auth.crypto.js";
import { createAdminReportingRouter } from "../src/modules/admin-reporting/reporting.routes.js";
import { ReportingController } from "../src/modules/admin-reporting/reporting.controller.js";
import type { ReportingService } from "../src/modules/admin-reporting/reporting.service.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";

const window = {
  from: new Date("2026-01-01T00:00:00.000+05:30"),
  toExclusive: new Date("2026-01-08T00:00:00.000+05:30"),
};

describe("Admin reporting HTTP", () => {
  let authRepo: InMemoryAuthRepository;
  let customerToken: string;
  let adminToken: string;
  let mockService: ReportingService;

  beforeEach(async () => {
    authRepo = new InMemoryAuthRepository();
    const customer = await authRepo.createUser({
      name: "Customer",
      email: "customer-reporting@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    customer.role = "CUSTOMER";
    customerToken = generateAccessToken(customer.id);

    const admin = await authRepo.createUser({
      name: "Admin",
      email: "admin-reporting@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    admin.role = "ADMIN";
    adminToken = generateAccessToken(admin.id);

    mockService = {
      getSummary: vi.fn().mockResolvedValue({
        success: true,
        data: { deliveriesCreated: { total: 0 } },
      }),
      getOrchestrationReporting: vi.fn().mockResolvedValue({
        success: true,
        data: { runsByStatus: {} },
      }),
      getRecentDeliveries: vi
        .fn()
        .mockResolvedValue({ success: true, data: { items: [] } }),
      getRecentActivity: vi
        .fn()
        .mockResolvedValue({ success: true, data: { hours: 24, items: [] } }),
      getFeedbackReporting: vi.fn().mockResolvedValue({
        success: true,
        data: { feedbackCount: 0, recentSnippets: [] },
      }),
    } as unknown as ReportingService;
  });

  function buildApp() {
    const controller = new ReportingController(mockService);
    const authenticate = createAuthenticateMiddleware(authRepo);
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use(
      "/api/v1/admin/reporting",
      createAdminReportingRouter({ controller, authenticateMiddleware: authenticate }),
    );
    app.use(errorHandlerMiddleware);
    return app;
  }

  const validQuery = {
    from: window.from.toISOString(),
    to: window.toExclusive.toISOString(),
  };

  it("rejects unauthenticated summary requests", async () => {
    const app = buildApp();
    expect(
      (await request(app).get("/api/v1/admin/reporting/summary").query(validQuery))
        .status,
    ).toBe(401);
  });

  it("forbids CUSTOMER from reporting endpoints", async () => {
    const app = buildApp();
    const response = await request(app)
      .get("/api/v1/admin/reporting/summary")
      .set("Authorization", `Bearer ${customerToken}`)
      .query(validQuery);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it("returns summary for ADMIN", async () => {
    const app = buildApp();
    const response = await request(app)
      .get("/api/v1/admin/reporting/summary")
      .set("Authorization", `Bearer ${adminToken}`)
      .query(validQuery);
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockService.getSummary).toHaveBeenCalled();
  });

  it("rejects reversed reporting ranges", async () => {
    const app = buildApp();
    const response = await request(app)
      .get("/api/v1/admin/reporting/summary")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({
        from: window.toExclusive.toISOString(),
        to: window.from.toISOString(),
      });
    expect(response.status).toBe(400);
  });

  it("propagates service failures without fabricating zero metrics", async () => {
    vi.mocked(mockService.getSummary).mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    const app = buildApp();
    const response = await request(app)
      .get("/api/v1/admin/reporting/summary")
      .set("Authorization", `Bearer ${adminToken}`)
      .query(validQuery);
    expect(response.status).toBe(500);
  });
});
