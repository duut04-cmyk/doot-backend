import { Router } from "express";
import { authenticate } from "../../core/middleware/authenticate.js";
import { validateRequest } from "../../core/validation/index.js";
import { deliveryIdParamsSchema } from "../delivery/delivery.schema.js";
import {
  orchestrationController,
  type OrchestrationController,
} from "./orchestration.controller.js";
import { orchestrateBodySchema } from "./orchestration.schema.js";

export function createOrchestrationRouter(
  controller: OrchestrationController = orchestrationController,
): Router {
  const router = Router({ mergeParams: true });

  router.post(
    "/:id/orchestrate",
    authenticate,
    validateRequest({
      params: deliveryIdParamsSchema,
      body: orchestrateBodySchema,
    }),
    controller.orchestrate,
  );

  router.get(
    "/:id/orchestration",
    authenticate,
    validateRequest({ params: deliveryIdParamsSchema }),
    controller.getLatest,
  );

  return router;
}

export const orchestrationRouter = createOrchestrationRouter();
