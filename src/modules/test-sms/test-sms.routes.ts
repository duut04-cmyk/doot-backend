import { Router } from "express";
import { validateRequest } from "../../core/validation/index.js";
import { testSmsController, type TestSmsController } from "./test-sms.controller.js";
import { testSmsBodySchema } from "./test-sms.schema.js";
import { isTestSmsEndpointEnabled } from "./test-sms.config.js";

export function createTestSmsRouter(options?: {
  controller?: TestSmsController;
  enabled?: boolean;
}): Router {
  const router = Router();
  const enabled = options?.enabled ?? isTestSmsEndpointEnabled();

  if (enabled) {
    const controller = options?.controller ?? testSmsController;
    router.post(
      "/sms",
      validateRequest({ body: testSmsBodySchema }),
      controller.sendTestSms,
    );
  }

  return router;
}
