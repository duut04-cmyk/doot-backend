import { createBorzoWebhookSignature } from "../../src/modules/provider/adapters/borzo/borzo.webhook.signature.js";

export function createTestBorzoWebhookSignature(
  rawBody: string | Buffer,
  secret = process.env.BORZO_CALLBACK_SECRET ??
    "test-borzo-callback-secret-min-16-chars",
): string {
  return createBorzoWebhookSignature(rawBody, secret);
}
