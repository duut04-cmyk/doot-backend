#!/usr/bin/env tsx
/**
 * Sandbox-only Shiprocket cancel verification helper.
 * - read: auth + order-show + optional tracking (no mutations)
 * - cancel: one POST /orders/cancel (requires --confirm-cancel I_UNDERSTAND_ONCE)
 * - reconcile: read-only order-show + tracking after cancel (no POST)
 *
 * Does not call Doot APIs or Cashfree. Does not enable webhooks.
 *
 * Usage:
 *   npm run verify:shiprocket-sandbox-cancel -- --phase read --order-id 16161616
 *   npm run verify:shiprocket-sandbox-cancel -- --phase cancel --order-id 16161616 --confirm-cancel I_UNDERSTAND_ONCE
 *   npm run verify:shiprocket-sandbox-cancel -- --phase reconcile --order-id 16161616
 */
/* eslint-disable no-console -- verification CLI output */
import { parseArgs } from "node:util";
import { config as loadDotenv } from "dotenv";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

loadDotenv({ path: resolve(process.cwd(), ".env"), override: false });

if (process.env.SHIPROCKET_ENABLED !== "true") {
  process.env.SHIPROCKET_ENABLED = "true";
}

const { env } = await import("../src/config/env.js");
const { assertShiprocketSandboxHttpsBaseUrl, ShiprocketSandboxProbeError } =
  await import("../src/modules/provider/adapters/shiprocket/shiprocket-sandbox-probe.js");
import type { ShiprocketSandboxCancelPhase } from "../src/modules/provider/adapters/shiprocket/shiprocket-sandbox-cancel-verify.js";

const { runShiprocketSandboxCancelVerify, SHIPROCKET_SANDBOX_CANCEL_CONFIRM_PHRASE } =
  await import("../src/modules/provider/adapters/shiprocket/shiprocket-sandbox-cancel-verify.js");

function printError(error: unknown): void {
  if (error instanceof ShiprocketSandboxProbeError) {
    console.error(
      JSON.stringify(
        { ok: false, errorCode: error.code, message: error.message },
        null,
        2,
      ),
    );
    return;
  }
  console.error(
    JSON.stringify(
      {
        ok: false,
        errorCode: "PROVIDER_ERROR",
        message: error instanceof Error ? error.message : "Verification failed.",
      },
      null,
      2,
    ),
  );
}

function parsePhase(value: string | undefined): ShiprocketSandboxCancelPhase {
  const phase = value?.trim().toLowerCase();
  if (phase === "read" || phase === "cancel" || phase === "reconcile") {
    return phase;
  }
  throw new ShiprocketSandboxProbeError(
    "VALIDATION",
    "--phase must be read, cancel, or reconcile.",
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      phase: { type: "string" },
      "order-id": { type: "string" },
      "confirm-cancel": { type: "string" },
      "run-dir": { type: "string" },
      "timeout-ms": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`Shiprocket sandbox cancel verification (sandbox host only)

Phases:
  read       Auth + GET order-show (+ tracking when AWB/shipment known). No cancel POST.
  cancel     Same pre-read, then exactly one POST /v1/external/orders/cancel.
  reconcile  Read-only order-show + tracking (use after waiting post-cancel).

Required:
  --phase read|cancel|reconcile
  --order-id <numeric Shiprocket data.id>

Cancel mutation guard:
  --confirm-cancel ${SHIPROCKET_SANDBOX_CANCEL_CONFIRM_PHRASE}

Environment (.env):
  SHIPROCKET_API_BASE_URL=https://api-sandbox.shiprocket.in  (required; apiv2 rejected)
  SHIPROCKET_AUTH_EMAIL, SHIPROCKET_AUTH_PASSWORD

Optional:
  --run-dir tmp/sandbox-runs/custom-run
  --timeout-ms 15000

Safety:
  - Never auto-retries cancel after timeout or ambiguous HTTP.
  - Does not trigger Doot CancellationService or Cashfree refunds.
  - Artifacts written with redacted identifiers under tmp/sandbox-runs/

Example:
  npm run verify:shiprocket-sandbox-cancel -- --phase read --order-id 16161616
  npm run verify:shiprocket-sandbox-cancel -- --phase cancel --order-id 16161616 --confirm-cancel ${SHIPROCKET_SANDBOX_CANCEL_CONFIRM_PHRASE}
  npm run verify:shiprocket-sandbox-cancel -- --phase reconcile --order-id 16161616
`);
    process.exit(0);
  }

  const phase = parsePhase(values.phase);
  const orderId = values["order-id"]?.trim();
  if (!orderId) {
    throw new ShiprocketSandboxProbeError(
      "VALIDATION",
      "--order-id is required (numeric Shiprocket order id).",
    );
  }

  const baseUrl = assertShiprocketSandboxHttpsBaseUrl(
    env.SHIPROCKET_API_BASE_URL ?? "https://api-sandbox.shiprocket.in",
  );

  if (!env.SHIPROCKET_AUTH_EMAIL || !env.SHIPROCKET_AUTH_PASSWORD) {
    throw new ShiprocketSandboxProbeError(
      "VALIDATION",
      "SHIPROCKET_AUTH_EMAIL and SHIPROCKET_AUTH_PASSWORD must be set in .env.",
    );
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const sandboxRunsRoot = resolve(process.cwd(), "tmp", "sandbox-runs");
  const defaultRunDir = join(sandboxRunsRoot, timestamp);
  const runDir = values["run-dir"]
    ? resolve(process.cwd(), values["run-dir"])
    : defaultRunDir;
  const normalizedRunDir = resolve(runDir);
  if (
    normalizedRunDir !== sandboxRunsRoot &&
    !normalizedRunDir.startsWith(`${sandboxRunsRoot}/`)
  ) {
    throw new ShiprocketSandboxProbeError(
      "VALIDATION",
      "--run-dir must be inside tmp/sandbox-runs/ for sandbox verification artifacts.",
    );
  }
  await mkdir(runDir, { recursive: true, mode: 0o700 });

  const timeoutMs = values["timeout-ms"]
    ? Number.parseInt(values["timeout-ms"], 10)
    : undefined;

  const result = await runShiprocketSandboxCancelVerify({
    baseUrl,
    orderId,
    phase,
    confirmCancel: values["confirm-cancel"],
    runDir,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : undefined,
  });

  console.log(
    JSON.stringify(
      {
        ...result,
        runDir,
        reminders: [
          "Do not retry cancel after timeout or ambiguous HTTP; reconcile with --phase reconcile.",
          "Restore SHIPROCKET_BOOKING_ENABLED=false and SHIPROCKET_WEBHOOK_ENABLED=false after testing.",
          "Provider Passbook/freight is not inferred from cancel HTTP responses.",
        ],
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  printError(error);
  process.exit(1);
});
