import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { authenticate } from "../../core/middleware/authenticate.js";
import { validateRequest } from "../../core/validation/index.js";
import { deliveryIdParamsSchema } from "../delivery/delivery.schema.js";
import {
  orchestrationController,
  type OrchestrationController,
} from "./orchestration.controller.js";
import { orchestrateBodySchema } from "./orchestration.schema.js";

type AuthenticateMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;

export function createOrchestrationRouter(
  controller: OrchestrationController = orchestrationController,
  options?: { authenticateMiddleware?: AuthenticateMiddleware },
): Router {
  const router = Router({ mergeParams: true });
  const auth = options?.authenticateMiddleware ?? authenticate;

  router.post(
    "/:id/orchestrate",
    auth,
    validateRequest({
      params: deliveryIdParamsSchema,
      body: orchestrateBodySchema,
    }),
    controller.orchestrate,
  );

  router.get(
    "/:id/orchestration",
    auth,
    validateRequest({ params: deliveryIdParamsSchema }),
    controller.getLatest,
  );

  return router;
}

export const orchestrationRouter = createOrchestrationRouter();
