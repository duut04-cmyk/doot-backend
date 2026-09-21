import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandlerMiddleware } from "../src/core/middleware/error-handler.js";
import { notFoundMiddleware } from "../src/core/middleware/not-found.js";
import { requestIdMiddleware } from "../src/core/middleware/request-id.js";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { AppError } from "../src/core/errors/app-error.js";
import { Msg91Service } from "../src/infrastructure/sms/msg91.service.js";
import { TestSmsController } from "../src/modules/test-sms/test-sms.controller.js";
import { createTestSmsRouter } from "../src/modules/test-sms/test-sms.routes.js";

describe("Test SMS HTTP", () => {
  let sendOtp: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendOtp = vi.fn(async () => undefined);
  });

  function buildApp(options?: { enabled?: boolean }) {
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use(
      "/api/v1/test",
      createTestSmsRouter({
        enabled: options?.enabled ?? true,
        controller: new TestSmsController(
          Object.assign(new Msg91Service(), { sendOtp }) as Msg91Service,
        ),
      }),
    );
    app.use(notFoundMiddleware);
    app.use(errorHandlerMiddleware);
    return app;
  }

  it("sends a test SMS without returning the OTP", async () => {
    const app = buildApp();
    const response = await request(app)
      .post("/api/v1/test/sms")
      .send({ phone: "9876543210", type: "ACCOUNT_OTP" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: "Test SMS sent successfully",
    });
    expect(JSON.stringify(response.body)).not.toMatch(/\d{6}/);
    expect(sendOtp).toHaveBeenCalledOnce();
    expect(sendOtp.mock.calls[0]?.[0]).toMatchObject({
      phone: "9876543210",
      type: "ACCOUNT_OTP",
    });
    expect(sendOtp.mock.calls[0]?.[0].otp).toMatch(/^\d{6}$/);
  });

  it("accepts all supported SMS types", async () => {
    const app = buildApp();

    for (const type of ["ACCOUNT_OTP", "PICKUP_OTP", "DELIVERY_OTP"] as const) {
      const response = await request(app)
        .post("/api/v1/test/sms")
        .send({ phone: "+919876543210", type });

      expect(response.status).toBe(200);
    }
  });

  it("rejects unknown SMS types", async () => {
    const app = buildApp();
    const response = await request(app)
      .post("/api/v1/test/sms")
      .send({ phone: "9876543210", type: "UNKNOWN" });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("returns disabled errors from the MSG91 service", async () => {
    sendOtp.mockRejectedValue(
      new AppError("MSG91 SMS service is disabled.", {
        statusCode: 503,
        code: ErrorCodes.SMS_NOT_CONFIGURED,
      }),
    );
    const app = buildApp();

    const response = await request(app)
      .post("/api/v1/test/sms")
      .send({ phone: "9876543210", type: "ACCOUNT_OTP" });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe(ErrorCodes.SMS_NOT_CONFIGURED);
    expect(JSON.stringify(response.body)).not.toContain("auth");
  });

  it("is not registered when disabled (production behavior)", async () => {
    const app = buildApp({ enabled: false });
    const response = await request(app)
      .post("/api/v1/test/sms")
      .send({ phone: "9876543210", type: "ACCOUNT_OTP" });

    expect(response.status).toBe(404);
  });
});
