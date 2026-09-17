import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { env } from "../../config/env.js";
import { authenticate } from "../../core/middleware/authenticate.js";
import { requireRole } from "../../core/middleware/authorize.js";
import { validateRequest } from "../../core/validation/index.js";
import {
  cancellationController,
  type CancellationController,
} from "../cancellation/cancellation.controller.js";
import { cancelDeliveryBodySchema } from "../cancellation/cancellation.schema.js";
import {
  driverController,
  type DriverController,
} from "../driver/driver.controller.js";
import { deliveryIdParamsSchema } from "../delivery/delivery.schema.js";
import { simulateDriverAssignmentBodySchema } from "../driver/driver.schema.js";
import { otpController, type OtpController } from "../otp/otp.controller.js";
import { verifyOtpBodySchema } from "../otp/otp.schema.js";
import {
  trackingController,
  type TrackingController,
} from "../tracking/tracking.controller.js";

type AuthenticateMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;

export function createOperationalRouter(options?: {
  driverController?: DriverController;
  otpController?: OtpController;
  trackingController?: TrackingController;
  cancellationController?: CancellationController;
  authenticateMiddleware?: AuthenticateMiddleware;
}): Router {
  const router = Router({ mergeParams: true });
  const driver = options?.driverController ?? driverController;
  const otp = options?.otpController ?? otpController;
  const tracking = options?.trackingController ?? trackingController;
  const cancellation = options?.cancellationController ?? cancellationController;
  const auth = options?.authenticateMiddleware ?? authenticate;

  router.get(
    "/:id/driver",
    auth,
    validateRequest({ params: deliveryIdParamsSchema }),
    driver.getDriver,
  );

  router.get(
    "/:id/tracking",
    auth,
    validateRequest({ params: deliveryIdParamsSchema }),
    tracking.getTracking,
  );

  router.get(
    "/:id/tracking/history",
    auth,
    validateRequest({ params: deliveryIdParamsSchema }),
    tracking.getHistory,
  );

  router.post(
    "/:id/pickup-otp",
    auth,
    validateRequest({ params: deliveryIdParamsSchema }),
    otp.generatePickupOtp,
  );

  router.post(
    "/:id/pickup/verify-otp",
    auth,
    validateRequest({
      params: deliveryIdParamsSchema,
      body: verifyOtpBodySchema,
    }),
    otp.verifyPickupOtp,
  );

  router.post(
    "/:id/delivery-otp",
    auth,
    validateRequest({ params: deliveryIdParamsSchema }),
    otp.generateDeliveryOtp,
  );

  router.post(
    "/:id/delivery/verify-otp",
    auth,
    validateRequest({
      params: deliveryIdParamsSchema,
      body: verifyOtpBodySchema,
    }),
    otp.verifyDeliveryOtp,
  );

  router.post(
    "/:id/cancel",
    auth,
    validateRequest({
      params: deliveryIdParamsSchema,
      body: cancelDeliveryBodySchema,
    }),
    cancellation.cancel,
  );

  router.get(
    "/:id/cancellation",
    auth,
    validateRequest({ params: deliveryIdParamsSchema }),
    cancellation.getCancellation,
  );

  return router;
}

export function createAdminOperationalRouter(options?: {
  driverController?: DriverController;
  trackingController?: TrackingController;
  authenticateMiddleware?: AuthenticateMiddleware;
  enableDriverSimulation?: boolean;
}): Router {
  const router = Router({ mergeParams: true });
  const driver = options?.driverController ?? driverController;
  const tracking = options?.trackingController ?? trackingController;
  const auth = options?.authenticateMiddleware ?? authenticate;

  router.use(auth, requireRole("ADMIN"));

  router.post(
    "/:id/driver/refresh",
    validateRequest({ params: deliveryIdParamsSchema }),
    driver.refreshFromProvider,
  );

  const enableDriverSimulation =
    options?.enableDriverSimulation ?? env.NODE_ENV !== "production";
  if (enableDriverSimulation) {
    router.post(
      "/:id/driver/simulate",
      validateRequest({
        params: deliveryIdParamsSchema,
        body: simulateDriverAssignmentBodySchema,
      }),
      driver.simulateProviderAssignment,
    );
  }

  router.post(
    "/:id/tracking/refresh",
    validateRequest({ params: deliveryIdParamsSchema }),
    tracking.refresh,
  );

  router.get(
    "/:id/driver",
    validateRequest({ params: deliveryIdParamsSchema }),
    driver.getDriver,
  );

  router.get(
    "/:id/tracking",
    validateRequest({ params: deliveryIdParamsSchema }),
    tracking.getTracking,
  );

  router.get(
    "/:id/tracking/history",
    validateRequest({ params: deliveryIdParamsSchema }),
    tracking.getHistory,
  );

  return router;
}
