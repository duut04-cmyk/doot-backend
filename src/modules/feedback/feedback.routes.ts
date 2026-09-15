import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { authenticate } from "../../core/middleware/authenticate.js";
import { validateRequest } from "../../core/validation/index.js";
import { deliveryIdParamsSchema } from "../delivery/delivery.schema.js";
import {
  feedbackController,
  type FeedbackController,
} from "./feedback.controller.js";
import { submitFeedbackBodySchema } from "./feedback.schema.js";

type AuthenticateMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;

export function createFeedbackRouter(
  controller: FeedbackController = feedbackController,
  authenticateMiddleware: AuthenticateMiddleware = authenticate,
): Router {
  const router = Router({ mergeParams: true });

  router.post(
    "/:id/feedback",
    authenticateMiddleware,
    validateRequest({
      params: deliveryIdParamsSchema,
      body: submitFeedbackBodySchema,
    }),
    controller.submit,
  );

  router.get(
    "/:id/feedback",
    authenticateMiddleware,
    validateRequest({ params: deliveryIdParamsSchema }),
    controller.getFeedback,
  );

  return router;
}

export const feedbackRouter = createFeedbackRouter();
