import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { authenticate } from "../../core/middleware/authenticate.js";
import { requireRole } from "../../core/middleware/authorize.js";
import { validateRequest } from "../../core/validation/index.js";
import type { BookingController } from "../booking/booking.controller.js";
import { createBookingRouter } from "../booking/booking.routes.js";
import type { FeedbackController } from "../feedback/feedback.controller.js";
import { createFeedbackRouter } from "../feedback/feedback.routes.js";
import { createOperationalRouter } from "../operations/operational.routes.js";
import type { RatingController } from "../rating/rating.controller.js";
import { createRatingRouter } from "../rating/rating.routes.js";
import type { OrchestrationController } from "../orchestration/orchestration.controller.js";
import { createOrchestrationRouter } from "../orchestration/orchestration.routes.js";
import {
  deliveryController,
  type DeliveryController,
} from "./delivery.controller.js";
import {
  createDeliverySchema,
  deliveryIdParamsSchema,
  listDeliveriesQuerySchema,
} from "./delivery.schema.js";

type AuthenticateMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;

export function createDeliveryRouter(
  controller: DeliveryController = deliveryController,
  orchestrationController?: OrchestrationController,
  bookingController?: BookingController,
  options?: {
    ratingController?: RatingController;
    feedbackController?: FeedbackController;
    authenticateMiddleware?: AuthenticateMiddleware;
  },
): Router {
  const router = Router();
  const auth = options?.authenticateMiddleware ?? authenticate;

  router.use(createOrchestrationRouter(orchestrationController));
  router.use(createBookingRouter(bookingController));
  router.use(createOperationalRouter());
  router.use(createRatingRouter(options?.ratingController, auth));
  router.use(createFeedbackRouter(options?.feedbackController, auth));

  router.post(
    "/",
    auth,
    requireRole("CUSTOMER"),
    validateRequest({ body: createDeliverySchema }),
    controller.create,
  );

  router.get(
    "/",
    auth,
    validateRequest({ query: listDeliveriesQuerySchema }),
    controller.list,
  );

  router.get(
    "/:id/history",
    auth,
    validateRequest({ params: deliveryIdParamsSchema }),
    controller.getHistoryDetail,
  );

  router.get(
    "/:id",
    auth,
    validateRequest({ params: deliveryIdParamsSchema }),
    controller.getById,
  );

  return router;
}

export const deliveryRouter = createDeliveryRouter();
