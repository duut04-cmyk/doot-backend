import { Router } from "express";
import { env } from "../config/env.js";
import { createAuthRouter } from "../modules/auth/auth.routes.js";
import type { AuthController } from "../modules/auth/auth.controller.js";
import { createDeliveryRouter } from "../modules/delivery/delivery.routes.js";
import type { DeliveryController } from "../modules/delivery/delivery.controller.js";
import { createAdminDeliveryHistoryRouter } from "../modules/delivery/delivery-history.routes.js";
import { createAdminOperationalRouter } from "../modules/operations/operational.routes.js";
import { createCustomerAdminRouter } from "../modules/customer/customer.routes.js";
import type { CustomerController } from "../modules/customer/customer.controller.js";
import { createIntegrationAdminRouter } from "../modules/integration/integration.routes.js";
import type { IntegrationController } from "../modules/integration/integration.controller.js";
import { createSettingsAdminRouter } from "../modules/settings/settings.routes.js";
import type { SettingsController } from "../modules/settings/settings.controller.js";
import { createProviderAdminRouter } from "../modules/provider/provider.routes.js";
import type { ProviderController } from "../modules/provider/provider.controller.js";
import { createTestSmsRouter } from "../modules/test-sms/test-sms.routes.js";

export function createApiV1Router(options?: {
  authController?: AuthController;
  customerController?: CustomerController;
  deliveryController?: DeliveryController;
  integrationController?: IntegrationController;
  settingsController?: SettingsController;
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
  router.use("/deliveries", createDeliveryRouter(options?.deliveryController));

  router.use(
    "/admin/customers",
    createCustomerAdminRouter(options?.customerController),
  );

  router.use(
    "/admin/integrations",
    createIntegrationAdminRouter(options?.integrationController),
  );

  router.use("/admin/settings", createSettingsAdminRouter(options?.settingsController));

  router.use(
    "/admin/providers",
    createProviderAdminRouter(options?.providerController),
  );

  router.use(
    "/admin/deliveries",
    createAdminOperationalRouter(),
    createAdminDeliveryHistoryRouter(),
  );

  if (env.NODE_ENV !== "production") {
    router.use("/test", createTestSmsRouter());
  }

  return router;
}

export const apiV1Router = createApiV1Router();
