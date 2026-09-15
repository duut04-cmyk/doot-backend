/**
 * Optional manual Borzo webhook smoke test.
 *
 * Sends a signed fixture payload to the local webhook endpoint.
 *
 * Usage:
 *   BORZO_CALLBACK_SECRET=... npx tsx scripts/borzo-webhook-smoke.ts
 *
 * Optional:
 *   WEBHOOK_BASE_URL=http://localhost:5000
 *   WEBHOOK_FIXTURE=order-created.json
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBorzoWebhookSignature } from "../src/modules/provider/adapters/borzo/borzo.webhook.signature.js";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../tests/fixtures/borzo",
);

async function main() {
  const secret = process.env.BORZO_CALLBACK_SECRET?.trim();
  if (!secret) {
    console.error("BORZO_CALLBACK_SECRET is required.");
    process.exit(1);
  }

  const baseUrl = process.env.WEBHOOK_BASE_URL?.trim() ?? "http://localhost:5000";
  const fixtureName = process.env.WEBHOOK_FIXTURE?.trim() ?? "order-created.json";
  const rawBody = readFileSync(join(fixturesDir, fixtureName), "utf8");
  const signature = createBorzoWebhookSignature(rawBody, secret);

  const response = await fetch(`${baseUrl}/api/v1/providers/borzo/webhooks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DV-Signature": signature,
    },
    body: rawBody,
  });

  const body = await response.text();
  process.stdout.write(
    `${JSON.stringify(
      {
        status: response.status,
        body: body.length > 0 ? JSON.parse(body) : null,
        fixture: fixtureName,
      },
      null,
      2,
    )}\n`,
  );

  if (!response.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Borzo webhook smoke test failed.");
  if (error instanceof Error) {
    console.error(error.message);
  }
  process.exit(1);
});
