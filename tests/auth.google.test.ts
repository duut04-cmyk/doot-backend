import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { requireJwtAccessSecret } from "../src/config/env.js";
import { AppError } from "../src/core/errors/app-error.js";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import type { GoogleCredentialVerifier } from "../src/infrastructure/auth/google-verifier.js";
import type { EmailSender } from "../src/infrastructure/email/email.service.js";
import { ACCESS_TOKEN_TYPE } from "../src/modules/auth/auth.constants.js";
import { AuthController } from "../src/modules/auth/auth.controller.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";

describe("Auth Part 4 Google login", () => {
  let repository: InMemoryAuthRepository;
  let service: AuthService;
  let mailer: EmailSender;
  let googleVerifier: GoogleCredentialVerifier;

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

  function mockGoogleIdentity(overrides?: {
    sub?: string;
    email?: string;
    emailVerified?: boolean;
    name?: string | null;
  }) {
    vi.mocked(googleVerifier.verifyIdToken).mockResolvedValue({
      sub: overrides?.sub ?? "google-sub-123",
      email: overrides?.email ?? "john@example.com",
      emailVerified: overrides?.emailVerified ?? true,
      name: overrides?.name === undefined ? "John Doe" : overrides.name,
      picture: null,
    });
  }

  it("rejects missing/empty credential over HTTP", async () => {
    const app = createApp({
      authController: new AuthController(service),
    });

    const missing = await request(app).post("/api/v1/auth/google").send({});
    expect(missing.status).toBe(400);

    const empty = await request(app)
      .post("/api/v1/auth/google")
      .send({ credential: "" });
    expect(empty.status).toBe(400);
  });

  it("rejects invalid Google credentials", async () => {
    vi.mocked(googleVerifier.verifyIdToken).mockRejectedValue(
      new AppError("Invalid Google credential.", {
        statusCode: 401,
        code: ErrorCodes.INVALID_GOOGLE_CREDENTIAL,
      }),
    );

    await expect(
      service.googleLogin({ credential: "bad-token" }),
    ).rejects.toMatchObject({
      code: ErrorCodes.INVALID_GOOGLE_CREDENTIAL,
      statusCode: 401,
    });
  });

  it("creates a new Google-only user and returns a Dutt session", async () => {
    mockGoogleIdentity();

    const result = await service.googleLogin({ credential: "google-id-token" });

    expect(result.success).toBe(true);
    expect(result.data.accessToken).toBeTruthy();
    expect(result.data.refreshToken).toBeTruthy();
    expect(repository.users).toHaveLength(1);
    expect(repository.users[0].email).toBe("john@example.com");
    expect(repository.users[0].emailVerified).toBe(true);
    expect(repository.users[0].passwordHash).toBeNull();
    expect(repository.users[0].status).toBe("ACTIVE");
    expect(repository.oauthAccounts).toHaveLength(1);
    expect(repository.oauthAccounts[0].provider).toBe("GOOGLE");
    expect(repository.oauthAccounts[0].providerAccountId).toBe(
      "google-sub-123",
    );

    const decoded = jwt.verify(
      result.data.accessToken,
      requireJwtAccessSecret(),
    ) as { sub: string; type: string };
    expect(decoded.sub).toBe(repository.users[0].id);
    expect(decoded.type).toBe(ACCESS_TOKEN_TYPE);
  });

  it("reuses an existing Google OAuth account without duplicating users", async () => {
    mockGoogleIdentity();
    await service.googleLogin({ credential: "google-id-token" });
    await service.googleLogin({ credential: "google-id-token" });

    expect(repository.users).toHaveLength(1);
    expect(repository.oauthAccounts).toHaveLength(1);
    expect(repository.refreshTokens).toHaveLength(2);
  });

  it("links Google to an existing password user and preserves password login", async () => {
    await service.signup({
      name: "John Smith",
      email: "john@example.com",
      password: "StrongPassword123!",
    });
    repository.users[0].emailVerified = true;
    const originalHash = repository.users[0].passwordHash;
    const originalName = repository.users[0].name;

    mockGoogleIdentity({
      email: "john@example.com",
      name: "Google Name",
    });
    const googleLogin = await service.googleLogin({
      credential: "google-id-token",
    });

    expect(repository.users).toHaveLength(1);
    expect(repository.users[0].passwordHash).toBe(originalHash);
    expect(repository.users[0].name).toBe(originalName);
    expect(repository.oauthAccounts).toHaveLength(1);
    expect(googleLogin.data.user.email).toBe("john@example.com");

    const passwordLogin = await service.login({
      email: "john@example.com",
      password: "StrongPassword123!",
    });
    expect(passwordLogin.success).toBe(true);
  });

  it("rejects suspended and deleted accounts", async () => {
    mockGoogleIdentity({ email: "suspended@example.com", sub: "sub-s" });
    await service.googleLogin({ credential: "token" });
    repository.users[0].status = "SUSPENDED";

    await expect(
      service.googleLogin({ credential: "token" }),
    ).rejects.toMatchObject({ code: ErrorCodes.ACCOUNT_SUSPENDED });

    mockGoogleIdentity({ email: "deleted@example.com", sub: "sub-d" });
    await service.googleLogin({ credential: "token-d" });
    const deleted = repository.users.find(
      (user) => user.email === "deleted@example.com",
    )!;
    deleted.status = "DELETED";

    await expect(
      service.googleLogin({ credential: "token-d" }),
    ).rejects.toMatchObject({ code: ErrorCodes.ACCOUNT_DELETED });
  });

  it("keeps Google-only users without a password hash", async () => {
    mockGoogleIdentity({ email: "oauth-only@example.com", sub: "sub-o" });
    await service.googleLogin({ credential: "token" });
    expect(repository.users[0].passwordHash).toBeNull();
  });

  it("rejects unverified Google emails from the verifier", async () => {
    vi.mocked(googleVerifier.verifyIdToken).mockRejectedValue(
      new AppError("Google email is not verified.", {
        statusCode: 401,
        code: ErrorCodes.INVALID_GOOGLE_CREDENTIAL,
      }),
    );

    await expect(
      service.googleLogin({ credential: "token" }),
    ).rejects.toMatchObject({
      code: ErrorCodes.INVALID_GOOGLE_CREDENTIAL,
    });
    expect(repository.users).toHaveLength(0);
  });

  it("supports refresh, logout, and /me after Google login", async () => {
    mockGoogleIdentity({ email: "session@example.com", sub: "sub-session" });
    const login = await service.googleLogin({ credential: "token" });

    const refreshed = await service.refreshSession({
      refreshToken: login.data.refreshToken,
    });
    expect(refreshed.data.accessToken).toBeTruthy();

    await expect(
      service.refreshSession({ refreshToken: login.data.refreshToken }),
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_REFRESH_TOKEN });

    await service.logout({ refreshToken: refreshed.data.refreshToken });
    await expect(
      service.refreshSession({ refreshToken: refreshed.data.refreshToken }),
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_REFRESH_TOKEN });

    const me = await service.getCurrentUser(repository.users[0].id);
    expect(me.data.user.email).toBe("session@example.com");
  });
});
