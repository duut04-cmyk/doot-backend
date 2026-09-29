import { Router } from "express";
import { authenticate } from "../../core/middleware/authenticate.js";
import { requireRole } from "../../core/middleware/authorize.js";
import { validateRequest } from "../../core/validation/index.js";
import { deliveryIdParamsSchema } from "../delivery/delivery.schema.js";
import { paymentController, type PaymentController } from "./payment.controller.js";

export function createPaymentRouter(
  controller: PaymentController = paymentController,
): Router {
  const router = Router({ mergeParams: true });

  router.post(
    "/:id/payment",
    authenticate,
    requireRole("CUSTOMER"),
    validateRequest({ params: deliveryIdParamsSchema }),
    controller.create,
  );

  router.get(
    "/:id/payment",
    authenticate,
    validateRequest({ params: deliveryIdParamsSchema }),
    controller.get,
  );

  return router;
}

export const paymentRouter = createPaymentRouter();
