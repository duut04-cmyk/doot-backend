import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { AuthController } from "../src/modules/auth/auth.controller.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";

describe("Auth admin login", () => {
  let repository: InMemoryAuthRepository;
  let service: AuthService;

  beforeEach(() => {
    repository = new InMemoryAuthRepository();
    service = new AuthService(repository, {
      sendVerificationEmail: vi.fn(async () => undefined),
      sendPasswordResetOtpEmail: vi.fn(async () => undefined),
      sendPickupOtpEmail: vi.fn(async () => undefined),
      sendDeliveryOtpEmail: vi.fn(async () => undefined),
    });
  });

  async function createVerifiedUser(role: "CUSTOMER" | "ADMIN" = "CUSTOMER") {
    await service.signup({
      name: "Test User",
      email: "user@example.com",
      password: "StrongPassword123!",
    });
    const user = repository.users[0];
    user.emailVerified = true;
    user.role = role;
    return user;
  }

  it("returns a session for verified ADMIN users", async () => {
    await createVerifiedUser("ADMIN");
    const result = await service.loginAdmin({
      email: "user@example.com",
      password: "StrongPassword123!",
    });
    expect(result.success).toBe(true);
    expect(result.data.accessToken).toBeTruthy();
    expect(result.data.user.role).toBe("ADMIN");
  });

  it("rejects verified CUSTOMER users with generic invalid credentials", async () => {
    await createVerifiedUser("CUSTOMER");
    await expect(
      service.loginAdmin({
        email: "user@example.com",
        password: "StrongPassword123!",
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: ErrorCodes.INVALID_CREDENTIALS,
    });
  });

  it("rejects invalid credentials for admin login", async () => {
    await createVerifiedUser("ADMIN");
    await expect(
      service.loginAdmin({
        email: "user@example.com",
        password: "WrongPassword123!",
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: ErrorCodes.INVALID_CREDENTIALS,
    });
  });

  it("POST /api/v1/auth/admin/login rejects non-admin while customer login works", async () => {
    await createVerifiedUser("CUSTOMER");
    const app = createApp({ authController: new AuthController(service) });

    const adminAttempt = await request(app)
      .post("/api/v1/auth/admin/login")
      .send({ email: "user@example.com", password: "StrongPassword123!" });
    expect(adminAttempt.status).toBe(401);
    expect(adminAttempt.body.error.code).toBe(ErrorCodes.INVALID_CREDENTIALS);

    const customerLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "user@example.com", password: "StrongPassword123!" });
    expect(customerLogin.status).toBe(200);
    expect(customerLogin.body.data.user.role).toBe("CUSTOMER");
  });
});
