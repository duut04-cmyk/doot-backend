import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison for inbound Shiprocket webhook `x-api-key`.
 * Returns false when lengths differ (without leaking the configured key).
 */
export function verifyShiprocketWebhookApiKey(input: {
  suppliedKey: string | undefined;
  configuredKey: string;
}): boolean {
  if (!input.suppliedKey || !input.configuredKey) {
    return false;
  }
  const suppliedBuf = Buffer.from(input.suppliedKey, "utf8");
  const configuredBuf = Buffer.from(input.configuredKey, "utf8");
  if (suppliedBuf.length !== configuredBuf.length) {
    return false;
  }
  return timingSafeEqual(suppliedBuf, configuredBuf);
}
