import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { authenticate } from "../../core/middleware/authenticate.js";
import { requireRole } from "../../core/middleware/authorize.js";
import { validateRequest } from "../../core/validation/index.js";
import {
  feedbackReportingQuerySchema,
  recentActivityQuerySchema,
  recentDeliveriesQuerySchema,
  reportingRangeQuerySchema,
} from "./reporting.schema.js";
import {
  reportingController,
  type ReportingController,
} from "./reporting.controller.js";

type AuthenticateMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;

export function createAdminReportingRouter(options?: {
  controller?: ReportingController;
  authenticateMiddleware?: AuthenticateMiddleware;
}): Router {
  const router = Router();
  const controller = options?.controller ?? reportingController;
  const auth = options?.authenticateMiddleware ?? authenticate;

  router.use(auth, requireRole("ADMIN"));

  router.get(
    "/summary",
    validateRequest({ query: reportingRangeQuerySchema }),
    controller.summary,
  );
  router.get(
    "/orchestration",
    validateRequest({ query: reportingRangeQuerySchema }),
    controller.orchestration,
  );
  router.get(
    "/recent-deliveries",
    validateRequest({ query: recentDeliveriesQuerySchema }),
    controller.recentDeliveries,
  );
  router.get(
    "/recent-activity",
    validateRequest({ query: recentActivityQuerySchema }),
    controller.recentActivity,
  );
  router.get(
    "/feedback",
    validateRequest({ query: feedbackReportingQuerySchema }),
    controller.feedback,
  );

  return router;
}
