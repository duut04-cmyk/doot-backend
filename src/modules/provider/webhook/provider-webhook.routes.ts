import { Router } from "express";
import {
  providerWebhookController,
  type ProviderWebhookController,
} from "./provider-webhook.controller.js";

export function createProviderWebhookRouter(
  controller: ProviderWebhookController = providerWebhookController,
): Router {
  const router = Router();
  router.post("/shiprocket", controller.handleShiprocket);
  /** Neutral path alias (Shiprocket dashboard discourages "shiprocket" in URLs). */
  router.post("/tracking", controller.handleShiprocket);
  return router;
}
