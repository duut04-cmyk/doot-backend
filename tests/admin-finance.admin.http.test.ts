import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { createAuthenticateMiddleware } from "../src/core/middleware/authenticate.js";
import { errorHandlerMiddleware } from "../src/core/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/core/middleware/request-id.js";
import { generateAccessToken } from "../src/modules/auth/auth.crypto.js";
import { AdminFinanceController } from "../src/modules/admin-finance/admin-finance.controller.js";
import {
  createAdminFinanceRouter,
  createAdminPaymentsRouter,
  createAdminRefundsRouter,
} from "../src/modules/admin-finance/admin-finance.routes.js";
import type { AdminFinanceService } from "../src/modules/admin-finance/admin-finance.service.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";

const range = {
  from: "2026-01-01T00:00:00.000+05:30",
  to: "2026-01-08T00:00:00.000+05:30",
};

describe("Admin finance HTTP", () => {
  let authRepo: InMemoryAuthRepository;
  let customerToken: string;
  let adminToken: string;
  let mockService: AdminFinanceService;

  beforeEach(async () => {
    authRepo = new InMemoryAuthRepository();
    const customer = await authRepo.createUser({
      name: "Customer",
      email: "customer-finance@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    customer.role = "CUSTOMER";
    customerToken = generateAccessToken(customer.id);

    const admin = await authRepo.createUser({
      name: "Admin",
      email: "admin-finance@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    admin.role = "ADMIN";
    adminToken = generateAccessToken(admin.id);

    mockService = {
      listPayments: vi.fn().mockResolvedValue({
        success: true,
        data: { items: [], page: 1, limit: 25, total: 0, totalPages: 0 },
      }),
      getSummary: vi.fn().mockResolvedValue({
        success: true,
        data: {
          window: { from: range.from, toExclusive: range.to, timeZone: "Asia/Kolkata" },
          collections: { count: 0, totalAmount: "0.00", currency: "INR" },
          successfulRefunds: { count: 0, totalAmount: "0.00", currency: "INR" },
          pendingRefunds: { count: 0, totalAmount: "0.00", currency: "INR" },
          failedRefunds: { count: 0, totalAmount: "0.00", currency: "INR" },
          netActivityInPeriod: {
            amount: "0.00",
            currency: "INR",
            formula: "collectionsInPeriod minus successfulRefundsProcessedInPeriod",
          },
          lifetime: {
            totalCollected: "0.00",
            totalSuccessfulRefunds: "0.00",
            net: "0.00",
            currency: "INR",
            formula:
              "lifetime gross collected (PAID, PARTIALLY_REFUNDED, REFUNDED with paidAt) minus lifetime SUCCESS refund amounts",
          },
        },
      }),
      getPaymentById: vi.fn(),
      listRefunds: vi.fn().mockResolvedValue({
        success: true,
        data: { items: [], page: 1, limit: 25, total: 0, totalPages: 0 },
      }),
      getTimeseries: vi.fn().mockResolvedValue({
        success: true,
        data: { window: {}, granularity: "day", currency: "INR", points: [] },
      }),
      getReconciliation: vi.fn().mockResolvedValue({
        success: true,
        data: { issues: [], issueCount: 0, truncated: false },
      }),
    } as unknown as AdminFinanceService;
  });

  function buildApp() {
    const controller = new AdminFinanceController(mockService);
    const authenticate = createAuthenticateMiddleware(authRepo);
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use(
      "/api/v1/admin/payments",
      createAdminPaymentsRouter({ controller, authenticateMiddleware: authenticate }),
    );
    app.use(
      "/api/v1/admin/refunds",
      createAdminRefundsRouter({ controller, authenticateMiddleware: authenticate }),
    );
    app.use(
      "/api/v1/admin/finance",
      createAdminFinanceRouter({ controller, authenticateMiddleware: authenticate }),
    );
    app.use(errorHandlerMiddleware);
    return app;
  }

  it("rejects unauthenticated payment list", async () => {
    const app = buildApp();
    expect((await request(app).get("/api/v1/admin/payments")).status).toBe(401);
  });

  it("forbids CUSTOMER from payments summary", async () => {
    const app = buildApp();
    const response = await request(app)
      .get("/api/v1/admin/payments/summary")
      .set("Authorization", `Bearer ${customerToken}`)
      .query(range);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it("returns payment summary for ADMIN", async () => {
    const app = buildApp();
    const response = await request(app)
      .get("/api/v1/admin/payments/summary")
      .set("Authorization", `Bearer ${adminToken}`)
      .query(range);
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockService.getSummary).toHaveBeenCalled();
  });

  it("validates reversed finance ranges", async () => {
    const app = buildApp();
    const response = await request(app)
      .get("/api/v1/admin/payments/summary")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({ from: range.to, to: range.from });
    expect(response.status).toBe(400);
  });

  it("returns refunds list for ADMIN", async () => {
    const app = buildApp();
    const response = await request(app)
      .get("/api/v1/admin/refunds")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(mockService.listRefunds).toHaveBeenCalled();
  });

  it("returns finance timeseries for ADMIN", async () => {
    const app = buildApp();
    const response = await request(app)
      .get("/api/v1/admin/finance/timeseries")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({ ...range, granularity: "day" });
    expect(response.status).toBe(200);
    expect(mockService.getTimeseries).toHaveBeenCalled();
  });
});
