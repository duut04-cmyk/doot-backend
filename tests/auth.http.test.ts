import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { AppError } from "../src/core/errors/app-error.js";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { AuthController } from "../src/modules/auth/auth.controller.js";
import { AuthService } from "../src/modules/auth/auth.service.js";

describe("Auth HTTP API", () => {
  const signup = vi.fn();
  const verifyOtp = vi.fn();
  const resendOtp = vi.fn();

  beforeEach(() => {
    signup.mockReset();
    verifyOtp.mockReset();
    resendOtp.mockReset();
  });

  function appWithMockService() {
    const service = {
      signup,
      verifyOtp,
      resendOtp,
    } as unknown as AuthService;
    return createApp({ authController: new AuthController(service) });
  }

  it("POST /api/v1/auth/signup returns 201 on success", async () => {
    signup.mockResolvedValue({
      success: true,
      message:
        "Account created. Please check your email for the verification code.",
    });

    const response = await request(appWithMockService())
      .post("/api/v1/auth/signup")
      .send({
        name: "John Doe",
        email: "john@example.com",
        phoneCountryCode: "+91",
        phoneNumber: "9876543210",
        password: "StrongPassword123!",
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body).not.toHaveProperty("otp");
    expect(response.body).not.toHaveProperty("password");
    expect(signup).toHaveBeenCalledWith({
      name: "John Doe",
      email: "john@example.com",
      phoneCountryCode: "+91",
      phoneNumber: "9876543210",
      password: "StrongPassword123!",
    });
  });

  it("POST /api/v1/auth/signup validates email and password", async () => {
    const app = appWithMockService();

    const invalidEmail = await request(app).post("/api/v1/auth/signup").send({
      name: "John Doe",
      email: "not-an-email",
      password: "StrongPassword123!",
    });
    expect(invalidEmail.status).toBe(400);
    expect(invalidEmail.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);

    const shortPassword = await request(app).post("/api/v1/auth/signup").send({
      name: "John Doe",
      email: "john@example.com",
      password: "short",
    });
    expect(shortPassword.status).toBe(400);

    const missing = await request(app).post("/api/v1/auth/signup").send({});
    expect(missing.status).toBe(400);
    expect(signup).not.toHaveBeenCalled();
  });

  it("POST /api/v1/auth/signup maps conflict errors", async () => {
    signup.mockRejectedValue(
      new AppError("An account with this email already exists", {
        statusCode: 409,
        code: ErrorCodes.EMAIL_ALREADY_REGISTERED,
      }),
    );

    const response = await request(appWithMockService())
      .post("/api/v1/auth/signup")
      .send({
        name: "John Doe",
        email: "john@example.com",
        password: "StrongPassword123!",
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe(ErrorCodes.EMAIL_ALREADY_REGISTERED);
  });

  it("POST /api/v1/auth/verify-otp returns success", async () => {
    verifyOtp.mockResolvedValue({
      success: true,
      message: "Email verified successfully.",
    });

    const response = await request(appWithMockService())
      .post("/api/v1/auth/verify-otp")
      .send({ email: "john@example.com", otp: "123456" });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Email verified successfully.");
    expect(response.body).not.toHaveProperty("otp");
  });

  it("POST /api/v1/auth/resend-otp returns success", async () => {
    resendOtp.mockResolvedValue({
      success: true,
      message:
        "If an account exists for this email, a verification code has been sent.",
    });

    const response = await request(appWithMockService())
      .post("/api/v1/auth/resend-otp")
      .send({ email: "john@example.com" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it("POST /api/v1/auth/resend-otp maps cooldown errors", async () => {
    resendOtp.mockRejectedValue(
      new AppError("Please wait before requesting another verification code", {
        statusCode: 429,
        code: ErrorCodes.OTP_RESEND_COOLDOWN,
      }),
    );

    const response = await request(appWithMockService())
      .post("/api/v1/auth/resend-otp")
      .send({ email: "john@example.com" });

    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe(ErrorCodes.OTP_RESEND_COOLDOWN);
  });
});
