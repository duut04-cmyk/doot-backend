import type { RequestHandler } from "express";
import { Router } from "express";
import { authenticate } from "../../core/middleware/authenticate.js";
import { requireRole } from "../../core/middleware/authorize.js";
import { settingsController, type SettingsController } from "./settings.controller.js";

export function createSettingsAdminRouter(
  controller: SettingsController = settingsController,
  authenticateMiddleware: RequestHandler = authenticate,
): Router {
  const router = Router();

  router.use(authenticateMiddleware, requireRole("ADMIN"));

  router.get("/", controller.getSnapshot);

  return router;
}

export const settingsAdminRouter = createSettingsAdminRouter();
