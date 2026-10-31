import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { authenticate } from "../../core/middleware/authenticate.js";
import { requireRole } from "../../core/middleware/authorize.js";
import { validateRequest } from "../../core/validation/index.js";
import {
  adminFinanceController,
  type AdminFinanceController,
} from "./admin-finance.controller.js";
import {
  financeRangeQuerySchema,
  financeReconciliationQuerySchema,
  financeTimeseriesQuerySchema,
  listPaymentsQuerySchema,
  listRefundsQuerySchema,
  paymentIdParamsSchema,
} from "./admin-finance.schema.js";

type AuthenticateMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;

export function createAdminPaymentsRouter(options?: {
  controller?: AdminFinanceController;
  authenticateMiddleware?: AuthenticateMiddleware;
}): Router {
  const router = Router();
  const controller = options?.controller ?? adminFinanceController;
  const auth = options?.authenticateMiddleware ?? authenticate;
  router.use(auth, requireRole("ADMIN"));

  router.get(
    "/",
    validateRequest({ query: listPaymentsQuerySchema }),
    controller.listPayments,
  );
  router.get(
    "/summary",
    validateRequest({ query: financeRangeQuerySchema }),
    controller.paymentSummary,
  );
  router.get(
    "/:id",
    validateRequest({ params: paymentIdParamsSchema }),
    controller.getPaymentById,
  );

  return router;
}

export function createAdminRefundsRouter(options?: {
  controller?: AdminFinanceController;
  authenticateMiddleware?: AuthenticateMiddleware;
}): Router {
  const router = Router();
  const controller = options?.controller ?? adminFinanceController;
  const auth = options?.authenticateMiddleware ?? authenticate;
  router.use(auth, requireRole("ADMIN"));

  router.get(
    "/",
    validateRequest({ query: listRefundsQuerySchema }),
    controller.listRefunds,
  );

  return router;
}

export function createAdminFinanceRouter(options?: {
  controller?: AdminFinanceController;
  authenticateMiddleware?: AuthenticateMiddleware;
}): Router {
  const router = Router();
  const controller = options?.controller ?? adminFinanceController;
  const auth = options?.authenticateMiddleware ?? authenticate;
  router.use(auth, requireRole("ADMIN"));

  router.get(
    "/timeseries",
    validateRequest({ query: financeTimeseriesQuerySchema }),
    controller.timeseries,
  );
  router.get(
    "/reconciliation",
    validateRequest({ query: financeReconciliationQuerySchema }),
    controller.reconciliation,
  );

  return router;
}
