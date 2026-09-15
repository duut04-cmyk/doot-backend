import { Router } from "express";
import { authenticate } from "../../core/middleware/authenticate.js";
import { validateRequest } from "../../core/validation/index.js";
import {
  authController,
  type AuthController,
} from "./auth.controller.js";
import {
  forgotPasswordSchema,
  googleLoginSchema,
  loginSchema,
  logoutSchema,
  refreshSessionSchema,
  resendOtpSchema,
  resetPasswordSchema,
  signupSchema,
  verifyOtpSchema,
} from "./auth.schema.js";

export function createAuthRouter(
  controller: AuthController = authController,
): Router {
  const router = Router();

  // TODO(security): add login / forgot-password rate limiting and refresh abuse protection later.
  router.post(
    "/signup",
    validateRequest({ body: signupSchema }),
    controller.signup,
  );

  router.post(
    "/verify-otp",
    validateRequest({ body: verifyOtpSchema }),
    controller.verifyOtp,
  );

  router.post(
    "/resend-otp",
    validateRequest({ body: resendOtpSchema }),
    controller.resendOtp,
  );

  router.post(
    "/login",
    validateRequest({ body: loginSchema }),
    controller.login,
  );

  router.post(
    "/refresh",
    validateRequest({ body: refreshSessionSchema }),
    controller.refresh,
  );

  router.post(
    "/logout",
    validateRequest({ body: logoutSchema }),
    controller.logout,
  );

  router.post(
    "/forgot-password",
    validateRequest({ body: forgotPasswordSchema }),
    controller.forgotPassword,
  );

  router.post(
    "/reset-password",
    validateRequest({ body: resetPasswordSchema }),
    controller.resetPassword,
  );

  router.post(
    "/google",
    validateRequest({ body: googleLoginSchema }),
    controller.googleLogin,
  );

  router.get("/me", authenticate, controller.me);

  return router;
}

export const authRouter = createAuthRouter();
