import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { authenticate } from "../../core/middleware/authenticate.js";
import { requireRole } from "../../core/middleware/authorize.js";
import { validateRequest } from "../../core/validation/index.js";
import {
  orchestrationController,
  type OrchestrationController,
} from "./orchestration.controller.js";
import {
  listOrchestrationsQuerySchema,
  orchestrationRequestIdParamsSchema,
} from "./orchestration.schema.js";

type AuthenticateMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;

export function createAdminOrchestrationListRouter(options?: {
  controller?: OrchestrationController;
  authenticateMiddleware?: AuthenticateMiddleware;
}): Router {
  const router = Router();
  const controller = options?.controller ?? orchestrationController;
  const auth = options?.authenticateMiddleware ?? authenticate;

  router.use(auth, requireRole("ADMIN"));

  router.get(
    "/",
    validateRequest({ query: listOrchestrationsQuerySchema }),
    controller.adminList,
  );

  router.get(
    "/:orchestrationRequestId",
    validateRequest({ params: orchestrationRequestIdParamsSchema }),
    controller.adminGetById,
  );

  return router;
}
