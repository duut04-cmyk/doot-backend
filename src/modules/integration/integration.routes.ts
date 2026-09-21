import type { RequestHandler } from "express";
import { Router } from "express";
import { authenticate } from "../../core/middleware/authenticate.js";
import { requireRole } from "../../core/middleware/authorize.js";
import {
  integrationController,
  type IntegrationController,
} from "./integration.controller.js";

export function createIntegrationAdminRouter(
  controller: IntegrationController = integrationController,
  authenticateMiddleware: RequestHandler = authenticate,
): Router {
  const router = Router();

  router.use(authenticateMiddleware, requireRole("ADMIN"));

  router.get("/status", controller.getStatus);

  return router;
}

export const integrationAdminRouter = createIntegrationAdminRouter();
