import { env } from "../../config/env.js";

/**
 * POST /api/v1/test/sms — MSG91 template smoke only.
 * Disabled in production regardless of env. Non-production requires ENABLE_TEST_SMS_ENDPOINT=true.
 */
export function isTestSmsEndpointEnabled(): boolean {
  if (env.NODE_ENV === "production") {
    return false;
  }
  return env.ENABLE_TEST_SMS_ENDPOINT === true;
}
