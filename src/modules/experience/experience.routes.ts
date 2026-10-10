import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { authenticate } from "../../core/middleware/authenticate.js";
import { validateRequest } from "../../core/validation/index.js";
import { deliveryIdParamsSchema } from "../delivery/delivery.schema.js";
import {
  experienceController,
  type ExperienceController,
} from "./experience.controller.js";
import { submitDeliveryExperienceBodySchema } from "./experience.schema.js";

type AuthenticateMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;

export function createExperienceRouter(
  controller: ExperienceController = experienceController,
  authenticateMiddleware: AuthenticateMiddleware = authenticate,
): Router {
  const router = Router({ mergeParams: true });

  router.post(
    "/:id/experience",
    authenticateMiddleware,
    validateRequest({
      params: deliveryIdParamsSchema,
      body: submitDeliveryExperienceBodySchema,
    }),
    controller.submit,
  );

  return router;
}

export const experienceRouter = createExperienceRouter();
