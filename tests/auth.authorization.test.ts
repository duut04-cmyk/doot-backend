import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireJwtAccessSecret } from "../src/config/env.js";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { createAuthenticateMiddleware } from "../src/core/middleware/authenticate.js";
import { requireRole } from "../src/core/middleware/authorize.js";
import { errorHandlerMiddleware } from "../src/core/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/core/middleware/request-id.js";
import { ACCESS_TOKEN_TYPE } from "../src/modules/auth/auth.constants.js";
import { generateAccessToken } from "../src/modules/auth/auth.crypto.js";
import { AuthController } from "../src/modules/auth/auth.controller.js";
import { signupSchema } from "../src/modules/auth/auth.schema.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";

describe("Auth Part 5 authorization", () => {
  let repository: InMemoryAuthRepository;
  let service: AuthService;
  let mailer: {
    sendVerificationEmail: ReturnType<typeof vi.fn>;
    sendPasswordResetOtpEmail: ReturnType<typeof vi.fn>;
    sendPickupOtpEmail: ReturnType<typeof vi.fn>;
  };
  let googleVerifier: {
    verifyIdToken: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    repository = new InMemoryAuthRepository();
    mailer = {
      sendVerificationEmail: vi.fn(async () => undefined),
      sendPasswordResetOtpEmail: vi.fn(async () => undefined),
      sendPickupOtpEmail: vi.fn(async () => undefined),
      sendDeliveryOtpEmail: vi.fn(async () => undefined),
    };
    googleVerifier = {
      verifyIdToken: vi.fn(),
    };
    service = new AuthService(repository, mailer, googleVerifier);
  });

  async function createVerifiedUser(overrides?: {
    email?: string;
    password?: string;
    role?: "CUSTOMER" | "ADMIN";
    status?: "ACTIVE" | "SUSPENDED" | "DELETED";
  }) {
    const email = overrides?.email ?? "customer@example.com";
    const password = overrides?.password ?? "StrongPassword123!";
    await service.signup({
      name: "Test User",
      email,
      password,
    });
    const user = repository.users.find((item) => item.email === email);
    if (!user) {
      throw new Error("Expected user after signup");
    }
    user.emailVerified = true;
    if (overrides?.role) {
      user.role = overrides.role;
    }
    if (overrides?.status) {
      user.status = overrides.status;
    }
    return { email, password, user };
  }

  function buildAuthzApp() {
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    const authenticate = createAuthenticateMiddleware(repository);
    const controller = new AuthController(service);

    const authRouter = express.Router();
    authRouter.get("/me", authenticate, controller.me);
    authRouter.post("/signup", async (req, res, next) => {
      try {
        const body = signupSchema.parse(req.body);
        const result = await service.signup(body);
        res.status(201).json(result);
      } catch (error) {
        next(error);
      }
    });

    const testRouter = express.Router();
    testRouter.get(
      "/customer",
      authenticate,
      requireRole("CUSTOMER"),
      (_req, res) => {
        res.status(200).json({ ok: true, surface: "customer" });
      },
    );
    testRouter.get(
      "/admin",
      authenticate,
      requireRole("ADMIN"),
      (_req, res) => {
        res.status(200).json({ ok: true, surface: "admin" });
      },
    );

    app.use("/api/v1/auth", authRouter);
    app.use("/__test__", testRouter);
    app.use(errorHandlerMiddleware);
    return app;
  }

  it("defaults signup users to CUSTOMER and ignores client role", async () => {
    const parsed = signupSchema.parse({
      name: "Attacker",
      email: "attacker@example.com",
      password: "Password123!",
      role: "ADMIN",
    });
    expect(parsed).not.toHaveProperty("role");

    await service.signup({
      ...parsed,
      // @ts-expect-error intentional escalation attempt
      role: "ADMIN",
    });

    const user = repository.users.find((u) => u.email === "attacker@example.com");
    expect(user?.role).toBe("CUSTOMER");
  });

  it("defaults new Google users to CUSTOMER", async () => {
    googleVerifier.verifyIdToken.mockResolvedValue({
      sub: "google-sub-1",
      email: "google-user@example.com",
      emailVerified: true,
      name: "Google User",
      picture: null,
    });

    const result = await service.googleLogin({
      credential: "fake-google-credential",
    });

    expect(result.data.user.role).toBe("CUSTOMER");
    expect(repository.users[0]?.role).toBe("CUSTOMER");
  });

  it("returns role on /me for CUSTOMER and ADMIN", async () => {
    const app = buildAuthzApp();
    const customer = await createVerifiedUser({
      email: "c@example.com",
      role: "CUSTOMER",
    });
    const admin = await createVerifiedUser({
      email: "a@example.com",
      role: "ADMIN",
    });

    const customerToken = generateAccessToken(customer.user.id);
    const adminToken = generateAccessToken(admin.user.id);

    const customerMe = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${customerToken}`);
    expect(customerMe.status).toBe(200);
    expect(customerMe.body.data.user.role).toBe("CUSTOMER");
    expect(customerMe.body.data.user).not.toHaveProperty("passwordHash");

    const adminMe = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminMe.status).toBe(200);
    expect(adminMe.body.data.user.role).toBe("ADMIN");
  });

  it("allows CUSTOMER on customer route and forbids admin route", async () => {
    const app = buildAuthzApp();
    const { user } = await createVerifiedUser({ role: "CUSTOMER" });
    const token = generateAccessToken(user.id);

    const customerRoute = await request(app)
      .get("/__test__/customer")
      .set("Authorization", `Bearer ${token}`);
    expect(customerRoute.status).toBe(200);

    const adminRoute = await request(app)
      .get("/__test__/admin")
      .set("Authorization", `Bearer ${token}`);
    expect(adminRoute.status).toBe(403);
    expect(adminRoute.body.error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it("allows ADMIN on admin route", async () => {
    const app = buildAuthzApp();
    const { user } = await createVerifiedUser({
      email: "admin@example.com",
      role: "ADMIN",
    });
    const token = generateAccessToken(user.id);

    const adminRoute = await request(app)
      .get("/__test__/admin")
      .set("Authorization", `Bearer ${token}`);
    expect(adminRoute.status).toBe(200);
  });

  it("returns 401 without token or with invalid JWT", async () => {
    const app = buildAuthzApp();

    const missing = await request(app).get("/__test__/admin");
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe(ErrorCodes.UNAUTHORIZED);

    const missingCustomer = await request(app).get("/__test__/customer");
    expect(missingCustomer.status).toBe(401);

    const invalid = await request(app)
      .get("/__test__/admin")
      .set("Authorization", "Bearer not-a-valid-jwt");
    expect(invalid.status).toBe(401);
  });

  it("rejects suspended and deleted users on protected routes", async () => {
    const app = buildAuthzApp();
    const suspended = await createVerifiedUser({
      email: "suspended@example.com",
      status: "SUSPENDED",
    });
    const deleted = await createVerifiedUser({
      email: "deleted@example.com",
      status: "DELETED",
    });

    const suspendedRes = await request(app)
      .get("/__test__/customer")
      .set("Authorization", `Bearer ${generateAccessToken(suspended.user.id)}`);
    expect(suspendedRes.status).toBe(403);
    expect(suspendedRes.body.error.code).toBe(ErrorCodes.ACCOUNT_SUSPENDED);

    const deletedRes = await request(app)
      .get("/__test__/customer")
      .set("Authorization", `Bearer ${generateAccessToken(deleted.user.id)}`);
    expect(deletedRes.status).toBe(403);
    expect(deletedRes.body.error.code).toBe(ErrorCodes.ACCOUNT_DELETED);
  });

  it("authorization follows database role changes, not JWT claims", async () => {
    const app = buildAuthzApp();
    const { user } = await createVerifiedUser({
      email: "promote@example.com",
      role: "CUSTOMER",
    });
    const token = generateAccessToken(user.id);

    const before = await request(app)
      .get("/__test__/admin")
      .set("Authorization", `Bearer ${token}`);
    expect(before.status).toBe(403);

    await repository.updateUser(user.id, { role: "ADMIN" });

    const afterPromote = await request(app)
      .get("/__test__/admin")
      .set("Authorization", `Bearer ${token}`);
    expect(afterPromote.status).toBe(200);

    await repository.updateUser(user.id, { role: "CUSTOMER" });

    const afterDemote = await request(app)
      .get("/__test__/admin")
      .set("Authorization", `Bearer ${token}`);
    expect(afterDemote.status).toBe(403);
  });

  it("access JWT contains sub and type only (no role claim)", async () => {
    const { user } = await createVerifiedUser({ role: "ADMIN" });
    const token = generateAccessToken(user.id);
    const payload = jwt.verify(token, requireJwtAccessSecret()) as Record<
      string,
      unknown
    >;

    expect(payload.sub).toBe(user.id);
    expect(payload.type).toBe(ACCESS_TOKEN_TYPE);
    expect(payload).not.toHaveProperty("role");
  });

  it("login and me responses omit sensitive fields", async () => {
    const { email, password, user } = await createVerifiedUser();
    const login = await service.login({ email, password });

    expect(login.data.user).toMatchObject({
      id: user.id,
      email,
      role: "CUSTOMER",
    });
    expect(login.data.user).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(login)).not.toContain("passwordHash");
    expect(JSON.stringify(login.data.user)).not.toMatch(/providerAccountId|otpHash|tokenHash/);
  });
});
