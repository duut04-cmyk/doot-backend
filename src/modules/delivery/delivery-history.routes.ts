import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { authenticate } from "../../core/middleware/authenticate.js";
import { requireRole } from "../../core/middleware/authorize.js";
import { validateRequest } from "../../core/validation/index.js";
import {
  deliveryController,
  type DeliveryController,
} from "./delivery.controller.js";
import { deliveryIdParamsSchema } from "./delivery.schema.js";

type AuthenticateMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;

export function createAdminDeliveryHistoryRouter(options?: {
  controller?: DeliveryController;
  authenticateMiddleware?: AuthenticateMiddleware;
}): Router {
  const router = Router({ mergeParams: true });
  const controller = options?.controller ?? deliveryController;
  const auth = options?.authenticateMiddleware ?? authenticate;

  router.use(auth, requireRole("ADMIN"));

  router.get(
    "/:id/history",
    validateRequest({ params: deliveryIdParamsSchema }),
    controller.getHistoryDetail,
  );

  return router;
}
