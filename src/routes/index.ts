import { Router } from "express";
import { createAuthRouter } from "../modules/auth/auth.routes.js";
import type { AuthController } from "../modules/auth/auth.controller.js";
import { createDeliveryRouter } from "../modules/delivery/delivery.routes.js";
import type { DeliveryController } from "../modules/delivery/delivery.controller.js";
import { createAdminDeliveryHistoryRouter } from "../modules/delivery/delivery-history.routes.js";
import { createAdminOperationalRouter } from "../modules/operations/operational.routes.js";
import { createProviderAdminRouter } from "../modules/provider/provider.routes.js";
import type { ProviderController } from "../modules/provider/provider.controller.js";

export function createApiV1Router(options?: {
  authController?: AuthController;
  deliveryController?: DeliveryController;
  providerController?: ProviderController;
}): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.status(200).json({
      success: true,
      data: {
        status: "ok",
      },
    });
  });

  router.use("/auth", createAuthRouter(options?.authController));
  router.use(
    "/deliveries",
    createDeliveryRouter(options?.deliveryController),
  );

  router.use(
    "/admin/providers",
    createProviderAdminRouter(options?.providerController),
  );

  router.use(
    "/admin/deliveries",
    createAdminOperationalRouter(),
    createAdminDeliveryHistoryRouter(),
  );

  return router;
}

export const apiV1Router = createApiV1Router();
