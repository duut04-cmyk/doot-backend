import { randomUUID } from "node:crypto";
import express, { type Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { createAuthenticateMiddleware } from "../src/core/middleware/authenticate.js";
import { errorHandlerMiddleware } from "../src/core/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/core/middleware/request-id.js";
import { generateAccessToken } from "../src/modules/auth/auth.crypto.js";
import { CustomerController } from "../src/modules/customer/customer.controller.js";
import { createCustomerAdminRouter } from "../src/modules/customer/customer.routes.js";
import { listCustomersQuerySchema } from "../src/modules/customer/customer.schema.js";
import { CustomerService } from "../src/modules/customer/customer.service.js";
import type { ICustomerRepository } from "../src/modules/customer/customer.repository.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";

describe("admin customer list API", () => {
  let authRepo: InMemoryAuthRepository;
  let adminId: string;
  let customerUserId: string;
  let listCustomers: ReturnType<typeof vi.fn>;
  let testApp: Express;

  beforeEach(async () => {
    authRepo = new InMemoryAuthRepository();
    listCustomers = vi.fn(async (page: number, _limit: number) => ({
      items: [
        {
          id: randomUUID(),
          name: "Page User",
          email: `user-${page}@example.com`,
          phoneCountryCode: null,
          phoneNumber: null,
          emailVerified: true,
          status: "ACTIVE" as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      total: 45,
    }));

    const repo = {
      listCustomers,
      findCustomerById: vi.fn(),
      updateCustomerStatus: vi.fn(),
      getOAuthProviders: vi.fn(async () => []),
      getDeliveryStats: vi.fn(),
      getDeliveryStatsForCustomers: vi.fn(async () => new Map()),
      getAverageRating: vi.fn(),
      listRecentDeliveries: vi.fn(),
    } satisfies ICustomerRepository;

    const service = new CustomerService(repo);

    const admin = await authRepo.createUser({
      name: "Admin",
      email: "admin@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    admin.role = "ADMIN";
    adminId = admin.id;

    const customer = await authRepo.createUser({
      name: "Customer",
      email: "cust@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    customer.role = "CUSTOMER";
    customerUserId = customer.id;

    testApp = express();
    testApp.use(express.json());
    testApp.use(requestIdMiddleware);
    const authenticate = createAuthenticateMiddleware(authRepo);
    testApp.use(
      "/api/v1/admin/customers",
      createCustomerAdminRouter(new CustomerController(service), authenticate),
    );
    testApp.use(errorHandlerMiddleware);
  });

  function tokenFor(userId: string) {
    return generateAccessToken(userId);
  }

  it("parses pagination query defaults and max limit", () => {
    const parsed = listCustomersQuerySchema.parse({ limit: "100" });
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(100);
    expect(() => listCustomersQuerySchema.parse({ limit: "101" })).toThrow();
  });

  it("returns paginated payload for ADMIN", async () => {
    const response = await request(testApp)
      .get("/api/v1/admin/customers?page=2&limit=20")
      .set("Authorization", `Bearer ${tokenFor(adminId)}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.page).toBe(2);
    expect(response.body.data.limit).toBe(20);
    expect(response.body.data.total).toBe(45);
    expect(response.body.data.totalPages).toBe(3);
    expect(listCustomers).toHaveBeenCalledWith(2, 20, expect.any(Object));
  });

  it("returns 403 for CUSTOMER role", async () => {
    const response = await request(testApp)
      .get("/api/v1/admin/customers")
      .set("Authorization", `Bearer ${tokenFor(customerUserId)}`);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it("returns 401 when unauthenticated", async () => {
    const response = await request(testApp).get("/api/v1/admin/customers");
    expect(response.status).toBe(401);
  });
});
