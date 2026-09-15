import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { authenticate } from "../../core/middleware/authenticate.js";
import { validateRequest } from "../../core/validation/index.js";
import { deliveryIdParamsSchema } from "../delivery/delivery.schema.js";
import { ratingController, type RatingController } from "./rating.controller.js";
import { submitRatingBodySchema } from "./rating.schema.js";

type AuthenticateMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;

export function createRatingRouter(
  controller: RatingController = ratingController,
  authenticateMiddleware: AuthenticateMiddleware = authenticate,
): Router {
  const router = Router({ mergeParams: true });

  router.post(
    "/:id/rating",
    authenticateMiddleware,
    validateRequest({
      params: deliveryIdParamsSchema,
      body: submitRatingBodySchema,
    }),
    controller.submit,
  );

  router.get(
    "/:id/rating",
    authenticateMiddleware,
    validateRequest({ params: deliveryIdParamsSchema }),
    controller.getRating,
  );

  return router;
}

export const ratingRouter = createRatingRouter();
