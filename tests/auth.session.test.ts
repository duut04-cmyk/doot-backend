import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { requireJwtAccessSecret } from "../src/config/env.js";
import { AppError } from "../src/core/errors/app-error.js";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { errorHandlerMiddleware } from "../src/core/middleware/error-handler.js";
import { createAuthenticateMiddleware } from "../src/core/middleware/authenticate.js";
import { requestIdMiddleware } from "../src/core/middleware/request-id.js";
import { ACCESS_TOKEN_TYPE } from "../src/modules/auth/auth.constants.js";
import { hashRefreshToken } from "../src/modules/auth/auth.crypto.js";
import { AuthController } from "../src/modules/auth/auth.controller.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";

describe("Auth Part 2 sessions", () => {
  let repository: InMemoryAuthRepository;
  let service: AuthService;
  let mailer: {
    sendVerificationEmail: ReturnType<typeof vi.fn>;
    sendPasswordResetOtpEmail: ReturnType<typeof vi.fn>;
    sendPickupOtpEmail: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    repository = new InMemoryAuthRepository();
    mailer = { 
      sendVerificationEmail: vi.fn(async () => undefined),
      sendPasswordResetOtpEmail: vi.fn(async () => undefined),
      sendPickupOtpEmail: vi.fn(async () => undefined),
      sendDeliveryOtpEmail: vi.fn(async () => undefined),
    };
    service = new AuthService(repository, mailer);
  });

  async function createVerifiedUser(overrides?: {
    email?: string;
    password?: string;
    status?: "ACTIVE" | "SUSPENDED" | "DELETED";
  }) {
    const email = overrides?.email ?? "john@example.com";
    const password = overrides?.password ?? "StrongPassword123!";
    await service.signup({
      name: "John Doe",
      email,
      phoneCountryCode: "+91",
      phoneNumber: "9876543210",
      password,
    });
    const user = repository.users.find((item) => item.email === email);
    if (!user) {
      throw new Error("Expected user to exist after signup");
    }
    user.emailVerified = true;
    if (overrides?.status) {
      user.status = overrides.status;
    }
    return { email, password, user };
  }

  function buildMeApp() {
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    const controller = new AuthController(service);
    const router = express.Router();
    router.get("/me", createAuthenticateMiddleware(repository), controller.me);
    app.use("/api/v1/auth", router);
    app.use(errorHandlerMiddleware);
    return app;
  }

  describe("login", () => {
    it("logs in a verified active user and stores hashed refresh token", async () => {
      const { email, password } = await createVerifiedUser();
      const result = await service.login({ email, password });

      expect(result.success).toBe(true);
      expect(result.data.accessToken).toBeTruthy();
      expect(result.data.refreshToken).toBeTruthy();
      expect(result.data.tokenType).toBe("Bearer");
      expect(result.data.expiresIn).toBe(900);
      expect(result.data.user).not.toHaveProperty("passwordHash");
      expect(repository.refreshTokens).toHaveLength(1);
      expect(repository.refreshTokens[0].tokenHash).toBe(
        hashRefreshToken(result.data.refreshToken),
      );
      expect(repository.refreshTokens[0].tokenHash).not.toBe(
        result.data.refreshToken,
      );
      expect(JSON.stringify(repository.refreshTokens)).not.toContain(
        result.data.refreshToken,
      );
    });

    it("rejects invalid password and unknown email with the same generic error", async () => {
      await createVerifiedUser();

      await expect(
        service.login({
          email: "john@example.com",
          password: "WrongPassword123!",
        }),
      ).rejects.toMatchObject({
        code: ErrorCodes.INVALID_CREDENTIALS,
        statusCode: 401,
      });

      await expect(
        service.login({
          email: "missing@example.com",
          password: "StrongPassword123!",
        }),
      ).rejects.toMatchObject({
        code: ErrorCodes.INVALID_CREDENTIALS,
        statusCode: 401,
      });
    });

    it("rejects unverified, suspended, and deleted users", async () => {
      await service.signup({
        name: "John Doe",
        email: "unverified@example.com",
        password: "StrongPassword123!",
      });
      await expect(
        service.login({
          email: "unverified@example.com",
          password: "StrongPassword123!",
        }),
      ).rejects.toMatchObject({ code: ErrorCodes.EMAIL_NOT_VERIFIED });

      await createVerifiedUser({
        email: "suspended@example.com",
        status: "SUSPENDED",
      });
      await expect(
        service.login({
          email: "suspended@example.com",
          password: "StrongPassword123!",
        }),
      ).rejects.toMatchObject({ code: ErrorCodes.ACCOUNT_SUSPENDED });

      await createVerifiedUser({
        email: "deleted@example.com",
        status: "DELETED",
      });
      await expect(
        service.login({
          email: "deleted@example.com",
          password: "StrongPassword123!",
        }),
      ).rejects.toMatchObject({ code: ErrorCodes.ACCOUNT_DELETED });
    });
  });

  describe("refresh rotation", () => {
    it("rotates tokens and rejects reuse of the old refresh token", async () => {
      const { email, password } = await createVerifiedUser();
      const login = await service.login({ email, password });
      const tokenA = login.data.refreshToken;

      const refreshed = await service.refreshSession({ refreshToken: tokenA });
      const tokenB = refreshed.data.refreshToken;

      expect(tokenB).not.toBe(tokenA);
      expect(repository.refreshTokens[0].revokedAt).not.toBeNull();
      expect(repository.refreshTokens[1].revokedAt).toBeNull();

      await expect(
        service.refreshSession({ refreshToken: tokenA }),
      ).rejects.toMatchObject({
        code: ErrorCodes.INVALID_REFRESH_TOKEN,
        statusCode: 401,
      });

      const again = await service.refreshSession({ refreshToken: tokenB });
      expect(again.data.accessToken).toBeTruthy();
      expect(again.data.refreshToken).not.toBe(tokenB);
    });

    it("rejects expired, revoked, and random refresh tokens", async () => {
      const { email, password } = await createVerifiedUser();
      const login = await service.login({ email, password });

      repository.refreshTokens[0].expiresAt = new Date(Date.now() - 1000);
      await expect(
        service.refreshSession({ refreshToken: login.data.refreshToken }),
      ).rejects.toMatchObject({ code: ErrorCodes.INVALID_REFRESH_TOKEN });

      const login2 = await service.login({ email, password });
      await service.logout({ refreshToken: login2.data.refreshToken });
      await expect(
        service.refreshSession({ refreshToken: login2.data.refreshToken }),
      ).rejects.toMatchObject({ code: ErrorCodes.INVALID_REFRESH_TOKEN });

      await expect(
        service.refreshSession({ refreshToken: "not-a-real-token" }),
      ).rejects.toMatchObject({ code: ErrorCodes.INVALID_REFRESH_TOKEN });
    });

    it("rejects refresh for suspended users", async () => {
      const { email, password, user } = await createVerifiedUser({
        email: "refresh-suspended@example.com",
      });
      const login = await service.login({ email, password });
      user.status = "SUSPENDED";

      await expect(
        service.refreshSession({ refreshToken: login.data.refreshToken }),
      ).rejects.toMatchObject({ code: ErrorCodes.INVALID_REFRESH_TOKEN });
    });
  });

  describe("logout", () => {
    it("revokes the refresh token and is idempotent", async () => {
      const { email, password } = await createVerifiedUser({
        email: "logout@example.com",
      });
      const login = await service.login({ email, password });

      const first = await service.logout({
        refreshToken: login.data.refreshToken,
      });
      const second = await service.logout({
        refreshToken: login.data.refreshToken,
      });

      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      expect(repository.refreshTokens[0].revokedAt).not.toBeNull();

      await expect(
        service.refreshSession({ refreshToken: login.data.refreshToken }),
      ).rejects.toMatchObject({ code: ErrorCodes.INVALID_REFRESH_TOKEN });
    });
  });

  describe("access token middleware and /me", () => {
    it("returns the current user for a valid access token", async () => {
      const { email, password } = await createVerifiedUser({
        email: "me@example.com",
      });
      const login = await service.login({ email, password });

      const response = await request(buildMeApp())
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${login.data.accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.user.email).toBe("me@example.com");
      expect(response.body.data.user).not.toHaveProperty("passwordHash");
      expect(response.body).not.toHaveProperty("refreshToken");
    });

    it("rejects missing, malformed, invalid, and expired tokens", async () => {
      const app = buildMeApp();
      const { email, password, user } = await createVerifiedUser({
        email: "token@example.com",
      });
      const login = await service.login({ email, password });

      expect((await request(app).get("/api/v1/auth/me")).status).toBe(401);

      expect(
        (
          await request(app)
            .get("/api/v1/auth/me")
            .set("Authorization", "Token abc")
        ).status,
      ).toBe(401);

      expect(
        (
          await request(app)
            .get("/api/v1/auth/me")
            .set("Authorization", "Bearer not-a-jwt")
        ).status,
      ).toBe(401);

      const expired = jwt.sign(
        {
          sub: user.id,
          type: ACCESS_TOKEN_TYPE,
          exp: Math.floor(Date.now() / 1000) - 10,
        },
        requireJwtAccessSecret(),
      );
      expect(
        (
          await request(app)
            .get("/api/v1/auth/me")
            .set("Authorization", `Bearer ${expired}`)
        ).status,
      ).toBe(401);

      const wrongSecret = jwt.sign(
        { sub: user.id, type: ACCESS_TOKEN_TYPE },
        "another-secret-that-is-long-enough-32",
        { expiresIn: "15m" },
      );
      expect(
        (
          await request(app)
            .get("/api/v1/auth/me")
            .set("Authorization", `Bearer ${wrongSecret}`)
        ).status,
      ).toBe(401);

      const wrongType = jwt.sign(
        { sub: user.id, type: "refresh" },
        requireJwtAccessSecret(),
        { expiresIn: "15m" },
      );
      expect(
        (
          await request(app)
            .get("/api/v1/auth/me")
            .set("Authorization", `Bearer ${wrongType}`)
        ).status,
      ).toBe(401);

      const missingSub = jwt.sign(
        { type: ACCESS_TOKEN_TYPE },
        requireJwtAccessSecret(),
        { expiresIn: "15m" },
      );
      expect(
        (
          await request(app)
            .get("/api/v1/auth/me")
            .set("Authorization", `Bearer ${missingSub}`)
        ).status,
      ).toBe(401);

      user.status = "SUSPENDED";
      expect(
        (
          await request(app)
            .get("/api/v1/auth/me")
            .set("Authorization", `Bearer ${login.data.accessToken}`)
        ).status,
      ).toBe(403);
    });
  });

  describe("HTTP login contract", () => {
    it("maps login success and invalid credentials through HTTP", async () => {
      const login = vi.fn();
      const controller = new AuthController({
        login,
      } as unknown as AuthService);
      const app = createApp({ authController: controller });

      login.mockResolvedValue({
        success: true,
        message: "Login successful.",
        data: {
          accessToken: "access",
          refreshToken: "refresh",
          tokenType: "Bearer",
          expiresIn: 900,
          user: {
            id: "1",
            name: "John",
            email: "john@example.com",
            phone: null,
            emailVerified: true,
          },
        },
      });

      const ok = await request(app).post("/api/v1/auth/login").send({
        email: "john@example.com",
        password: "StrongPassword123!",
      });
      expect(ok.status).toBe(200);
      expect(ok.body.data.accessToken).toBe("access");

      login.mockRejectedValue(
        new AppError("Invalid email or password.", {
          statusCode: 401,
          code: ErrorCodes.INVALID_CREDENTIALS,
        }),
      );
      const bad = await request(app).post("/api/v1/auth/login").send({
        email: "john@example.com",
        password: "wrong-password",
      });
      expect(bad.status).toBe(401);
      expect(bad.body.error.code).toBe(ErrorCodes.INVALID_CREDENTIALS);
    });
  });
});
