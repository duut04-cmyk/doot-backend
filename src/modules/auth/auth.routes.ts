import { Router } from "express";
import {
  forgotPasswordEmailRateLimit,
  forgotPasswordIpRateLimit,
  googleLoginIpRateLimit,
  loginEmailRateLimit,
  loginIpRateLimit,
  refreshIpRateLimit,
  refreshTokenRateLimit,
  resendEmailOtpEmailRateLimit,
  resendEmailOtpIpRateLimit,
  resendPasswordResetOtpEmailRateLimit,
  resendPasswordResetOtpIpRateLimit,
  resetPasswordIpRateLimit,
  signupEmailRateLimit,
  signupIpRateLimit,
  verifyEmailOtpEmailRateLimit,
  verifyEmailOtpIpRateLimit,
  verifyPasswordResetOtpEmailRateLimit,
  verifyPasswordResetOtpIpRateLimit,
} from "../../core/middleware/auth-rate-limits.js";
import { authenticate } from "../../core/middleware/authenticate.js";
import { validateRequest } from "../../core/validation/index.js";
import { authController, type AuthController } from "./auth.controller.js";
import {
  forgotPasswordSchema,
  googleLoginSchema,
  loginSchema,
  logoutSchema,
  refreshSessionSchema,
  resendOtpSchema,
  resendPasswordResetOtpSchema,
  resetPasswordSchema,
  verifyPasswordResetOtpSchema,
  signupSchema,
  verifyOtpSchema,
} from "./auth.schema.js";

export function createAuthRouter(controller: AuthController = authController): Router {
  const router = Router();

  router.post(
    "/signup",
    signupIpRateLimit,
    validateRequest({ body: signupSchema }),
    signupEmailRateLimit,
    controller.signup,
  );

  router.post(
    "/verify-otp",
    verifyEmailOtpIpRateLimit,
    validateRequest({ body: verifyOtpSchema }),
    verifyEmailOtpEmailRateLimit,
    controller.verifyOtp,
  );

  router.post(
    "/resend-otp",
    resendEmailOtpIpRateLimit,
    validateRequest({ body: resendOtpSchema }),
    resendEmailOtpEmailRateLimit,
    controller.resendOtp,
  );

  router.post(
    "/login",
    loginIpRateLimit,
    validateRequest({ body: loginSchema }),
    loginEmailRateLimit,
    controller.login,
  );

  router.post(
    "/refresh",
    refreshIpRateLimit,
    validateRequest({ body: refreshSessionSchema }),
    refreshTokenRateLimit,
    controller.refresh,
  );

  router.post(
    "/logout",
    refreshIpRateLimit,
    validateRequest({ body: logoutSchema }),
    refreshTokenRateLimit,
    controller.logout,
  );

  router.post(
    "/forgot-password",
    forgotPasswordIpRateLimit,
    validateRequest({ body: forgotPasswordSchema }),
    forgotPasswordEmailRateLimit,
    controller.forgotPassword,
  );

  router.post(
    "/verify-password-reset-otp",
    verifyPasswordResetOtpIpRateLimit,
    validateRequest({ body: verifyPasswordResetOtpSchema }),
    verifyPasswordResetOtpEmailRateLimit,
    controller.verifyPasswordResetOtp,
  );

  router.post(
    "/resend-password-reset-otp",
    resendPasswordResetOtpIpRateLimit,
    validateRequest({ body: resendPasswordResetOtpSchema }),
    resendPasswordResetOtpEmailRateLimit,
    controller.resendPasswordResetOtp,
  );

  router.post(
    "/reset-password",
    resetPasswordIpRateLimit,
    validateRequest({ body: resetPasswordSchema }),
    controller.resetPassword,
  );

  router.post(
    "/google",
    googleLoginIpRateLimit,
    validateRequest({ body: googleLoginSchema }),
    controller.googleLogin,
  );

  router.get("/me", authenticate, controller.me);

  return router;
}

export const authRouter = createAuthRouter();
