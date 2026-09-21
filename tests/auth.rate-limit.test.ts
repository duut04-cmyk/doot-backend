import request from "supertest";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createApp } from "../src/app.js";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { AUTH_RATE_LIMIT_WINDOWS } from "../src/core/middleware/auth-rate-limits.js";
import { resetRateLimitStores } from "../src/core/middleware/rate-limit.js";
import { AuthController } from "../src/modules/auth/auth.controller.js";
import { AuthService } from "../src/modules/auth/auth.service.js";

describe("Auth rate limiting", () => {
  const login = vi.fn();

  beforeAll(() => {
    process.env.ENABLE_RATE_LIMIT_TESTS = "true";
  });

  afterAll(() => {
    delete process.env.ENABLE_RATE_LIMIT_TESTS;
  });

  beforeEach(() => {
    resetRateLimitStores();
    login.mockReset();
    login.mockResolvedValue({
      success: true,
      data: {
        accessToken: "token",
        refreshToken: "refresh",
        expiresIn: 900,
        user: { id: "u1", email: "john@example.com" },
      },
      message: "Login successful.",
    });
  });

  afterEach(() => {
    resetRateLimitStores();
  });

  function appWithMockLogin() {
    const service = { login } as unknown as AuthService;
    return createApp({ authController: new AuthController(service) });
  }

  const loginBody = {
    email: "john@example.com",
    password: "StrongPassword123!",
  };

  it("returns 429 with RATE_LIMIT_EXCEEDED after IP login limit is exceeded", async () => {
    const app = appWithMockLogin();
    const max = AUTH_RATE_LIMIT_WINDOWS.loginIp.max;

    for (let attempt = 0; attempt < max; attempt += 1) {
      const response = await request(app)
        .post("/api/v1/auth/login")
        .send({ ...loginBody, email: `user-${attempt}@example.com` });
      expect(response.status).toBe(200);
    }

    const blocked = await request(app)
      .post("/api/v1/auth/login")
      .send({ ...loginBody, email: "blocked@example.com" });

    expect(blocked.status).toBe(429);
    expect(blocked.body.success).toBe(false);
    expect(blocked.body.error.code).toBe(ErrorCodes.RATE_LIMIT_EXCEEDED);
    expect(blocked.headers["retry-after"]).toBeTruthy();
    expect(login).toHaveBeenCalledTimes(max);
  });

  it("returns 429 after per-email login limit is exceeded", async () => {
    const app = appWithMockLogin();
    const max = AUTH_RATE_LIMIT_WINDOWS.loginEmail.max;

    for (let attempt = 0; attempt < max; attempt += 1) {
      const response = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.0.0.${attempt}`)
        .send(loginBody);
      expect(response.status).toBe(200);
    }

    const blocked = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", "10.0.0.99")
      .send(loginBody);

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe(ErrorCodes.RATE_LIMIT_EXCEEDED);
    expect(login).toHaveBeenCalledTimes(max);
  });

  it("allows requests again after the rate-limit window resets", async () => {
    vi.useFakeTimers();
    const app = appWithMockLogin();
    const max = AUTH_RATE_LIMIT_WINDOWS.loginIp.max;

    for (let attempt = 0; attempt < max; attempt += 1) {
      await request(app).post("/api/v1/auth/login").send(loginBody);
    }

    const blocked = await request(app).post("/api/v1/auth/login").send(loginBody);
    expect(blocked.status).toBe(429);

    vi.advanceTimersByTime(AUTH_RATE_LIMIT_WINDOWS.loginIp.windowMs + 1);

    const recovered = await request(app).post("/api/v1/auth/login").send(loginBody);
    expect(recovered.status).toBe(200);

    vi.useRealTimers();
  });

  it("does not expose whether an email exists when rate limited on login", async () => {
    const app = appWithMockLogin();
    login.mockRejectedValue(new Error("should not reach service"));

    const max = AUTH_RATE_LIMIT_WINDOWS.loginIp.max;
    for (let attempt = 0; attempt < max; attempt += 1) {
      await request(app).post("/api/v1/auth/login").send(loginBody);
    }

    const blocked = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "unknown@example.com", password: "WrongPassword1!" });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.message).toBe(
      "Too many requests. Please try again later.",
    );
    expect(blocked.body.error.code).toBe(ErrorCodes.RATE_LIMIT_EXCEEDED);
  });
});
