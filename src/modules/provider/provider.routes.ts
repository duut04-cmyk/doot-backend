import type { RequestHandler } from "express";
import { Router } from "express";
import { authenticate } from "../../core/middleware/authenticate.js";
import { requireRole } from "../../core/middleware/authorize.js";
import { validateRequest } from "../../core/validation/index.js";
import {
  providerController,
  type ProviderController,
} from "./provider.controller.js";
import {
  createProviderSchema,
  createProviderServiceSchema,
  createProviderVehicleSchema,
  providerIdParamsSchema,
  providerServiceParamsSchema,
  providerVehicleParamsSchema,
  replaceCapabilitiesSchema,
  updateProviderSchema,
  updateProviderServiceSchema,
  updateProviderStatusSchema,
  updateProviderVehicleSchema,
  upsertCredentialsSchema,
  providerTestQuoteBodySchema,
} from "./provider.schema.js";

export function createProviderAdminRouter(
  controller: ProviderController = providerController,
  authenticateMiddleware: RequestHandler = authenticate,
): Router {
  const router = Router();

  router.use(authenticateMiddleware, requireRole("ADMIN"));

  router.post(
    "/",
    validateRequest({ body: createProviderSchema }),
    controller.create,
  );

  router.get("/", controller.list);

  router.get(
    "/:id",
    validateRequest({ params: providerIdParamsSchema }),
    controller.getById,
  );

  router.patch(
    "/:id",
    validateRequest({
      params: providerIdParamsSchema,
      body: updateProviderSchema,
    }),
    controller.update,
  );

  router.patch(
    "/:id/status",
    validateRequest({
      params: providerIdParamsSchema,
      body: updateProviderStatusSchema,
    }),
    controller.updateStatus,
  );

  router.put(
    "/:id/credentials",
    validateRequest({
      params: providerIdParamsSchema,
      body: upsertCredentialsSchema,
    }),
    controller.upsertCredentials,
  );

  router.put(
    "/:id/capabilities",
    validateRequest({
      params: providerIdParamsSchema,
      body: replaceCapabilitiesSchema,
    }),
    controller.replaceCapabilities,
  );

  router.post(
    "/:id/services",
    validateRequest({
      params: providerIdParamsSchema,
      body: createProviderServiceSchema,
    }),
    controller.createService,
  );

  router.get(
    "/:id/services",
    validateRequest({ params: providerIdParamsSchema }),
    controller.listServices,
  );

  router.patch(
    "/:id/services/:serviceId",
    validateRequest({
      params: providerServiceParamsSchema,
      body: updateProviderServiceSchema,
    }),
    controller.updateService,
  );

  router.post(
    "/:id/vehicles",
    validateRequest({
      params: providerIdParamsSchema,
      body: createProviderVehicleSchema,
    }),
    controller.createVehicle,
  );

  router.get(
    "/:id/vehicles",
    validateRequest({ params: providerIdParamsSchema }),
    controller.listVehicles,
  );

  router.patch(
    "/:id/vehicles/:vehicleId",
    validateRequest({
      params: providerVehicleParamsSchema,
      body: updateProviderVehicleSchema,
    }),
    controller.updateVehicle,
  );

  router.post(
    "/:id/test-connection",
    validateRequest({ params: providerIdParamsSchema }),
    controller.testConnection,
  );

  router.post(
    "/:id/test-quote",
    validateRequest({
      params: providerIdParamsSchema,
      body: providerTestQuoteBodySchema,
    }),
    controller.testQuote,
  );

  return router;
}

export const providerAdminRouter = createProviderAdminRouter();
