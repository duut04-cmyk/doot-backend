import { Router } from "express";
import { authenticate } from "../../core/middleware/authenticate.js";
import { validateRequest } from "../../core/validation/index.js";
import { deliveryIdParamsSchema } from "../delivery/delivery.schema.js";
import {
  bookingController,
  type BookingController,
} from "./booking.controller.js";
import { confirmDeliveryBodySchema } from "./booking.schema.js";

export function createBookingRouter(
  controller: BookingController = bookingController,
): Router {
  const router = Router({ mergeParams: true });

  router.post(
    "/:id/confirm",
    authenticate,
    validateRequest({
      params: deliveryIdParamsSchema,
      body: confirmDeliveryBodySchema,
    }),
    controller.confirm,
  );

  router.get(
    "/:id/booking",
    authenticate,
    validateRequest({ params: deliveryIdParamsSchema }),
    controller.getBooking,
  );

  return router;
}

export const bookingRouter = createBookingRouter();
