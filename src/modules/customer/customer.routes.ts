import type { RequestHandler } from "express";
import { Router } from "express";
import { authenticate } from "../../core/middleware/authenticate.js";
import { requireRole } from "../../core/middleware/authorize.js";
import { validateRequest } from "../../core/validation/index.js";
import { customerController, type CustomerController } from "./customer.controller.js";
import {
  customerIdParamsSchema,
  listCustomersQuerySchema,
  updateCustomerSchema,
} from "./customer.schema.js";

export function createCustomerAdminRouter(
  controller: CustomerController = customerController,
  authenticateMiddleware: RequestHandler = authenticate,
): Router {
  const router = Router();

  router.use(authenticateMiddleware, requireRole("ADMIN"));

  router.get(
    "/",
    validateRequest({ query: listCustomersQuerySchema }),
    controller.list,
  );

  router.get(
    "/:id",
    validateRequest({ params: customerIdParamsSchema }),
    controller.getById,
  );

  router.patch(
    "/:id",
    validateRequest({
      params: customerIdParamsSchema,
      body: updateCustomerSchema,
    }),
    controller.update,
  );

  return router;
}

export const customerAdminRouter = createCustomerAdminRouter();
