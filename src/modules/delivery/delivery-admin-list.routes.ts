import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { authenticate } from "../../core/middleware/authenticate.js";
import { requireRole } from "../../core/middleware/authorize.js";
import { validateRequest } from "../../core/validation/index.js";
import { deliveryController, type DeliveryController } from "./delivery.controller.js";
import { listDeliveriesQuerySchema } from "./delivery.schema.js";

type AuthenticateMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;

export function createAdminDeliveryListRouter(options?: {
  controller?: DeliveryController;
  authenticateMiddleware?: AuthenticateMiddleware;
}): Router {
  const router = Router();
  const controller = options?.controller ?? deliveryController;
  const auth = options?.authenticateMiddleware ?? authenticate;

  router.use(auth, requireRole("ADMIN"));

  router.get(
    "/",
    validateRequest({ query: listDeliveriesQuerySchema }),
    controller.adminList,
  );

  return router;
}
