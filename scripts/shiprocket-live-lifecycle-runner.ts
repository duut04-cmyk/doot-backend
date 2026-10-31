#!/usr/bin/env tsx
/**
 * Shiprocket LIVE lifecycle verification runner (default: dry-run preflight only).
 *
 * Usage:
 *   npm run verify:shiprocket-live-lifecycle -- \\
 *     --delivery-reference DOOT-LIVE-TEST-001 \\
 *     --delivery-id <uuid>
 *
 *   # Execute (mutations + live HTTP) requires --confirm-live-host and --confirm-cancel.
 */
/* eslint-disable no-console -- CLI output */
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

loadDotenv({ path: resolve(process.cwd(), ".env"), override: false });

const { runShiprocketLiveLifecycle } =
  await import("../src/modules/provider/adapters/shiprocket/shiprocket-live-lifecycle-execute.lib.js");
const { providerConfigResolver } =
  await import("../src/modules/provider/adapters/provider-config-resolver.js");
const { bookingService } = await import("../src/modules/booking/booking.service.js");
const { cancellationService } =
  await import("../src/modules/cancellation/cancellation.service.js");
const { providerAdapterExecutor } =
  await import("../src/modules/provider/adapters/provider-adapter-executor.js");
const { deliveryRepository } =
  await import("../src/modules/delivery/delivery.repository.js");
const { bookingRepository } =
  await import("../src/modules/booking/booking.repository.js");
const { cancellationRepository } =
  await import("../src/modules/cancellation/cancellation.repository.js");
const { orchestrationRepository } =
  await import("../src/modules/orchestration/orchestration.repository.js");
const { paymentRepository } =
  await import("../src/modules/payment/payment.repository.js");
const { providerRepository } =
  await import("../src/modules/provider/provider.repository.js");
const { env } = await import("../src/config/env.js");
const { SHIPROCKET_LIVE_CANCEL_CONFIRM_PHRASE, SHIPROCKET_LIVE_HOST_CONFIRM_PHRASE } =
  await import("../src/modules/provider/adapters/shiprocket/shiprocket-live-lifecycle.guards.js");

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: true },
      execute: { type: "boolean", default: false },
      "confirm-live-host": { type: "string" },
      "confirm-cancel": { type: "string" },
      "delivery-reference": { type: "string" },
      "delivery-id": { type: "string" },
      "run-id": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`Shiprocket live lifecycle runner (default dry-run).

Options:
  --dry-run (default true unless --execute)
  --execute
  --confirm-live-host ${SHIPROCKET_LIVE_HOST_CONFIRM_PHRASE} (required for --execute only)
  --confirm-cancel ${SHIPROCKET_LIVE_CANCEL_CONFIRM_PHRASE} (required for cancel phase on --execute)
  --delivery-reference <unique reference on delivery row>
  --delivery-id <uuid> (required)
  --run-id <optional unique artifact directory name>`);
    process.exit(0);
  }

  const dryRun = values.execute ? false : (values["dry-run"] ?? true);
  const runId = values["run-id"]?.trim() || `live-${randomUUID()}`;
  const deliveryId = values["delivery-id"]?.trim();
  const deliveryReference = values["delivery-reference"]?.trim();

  if (!deliveryId) {
    throw new Error("--delivery-id is required.");
  }
  if (!deliveryReference) {
    throw new Error("--delivery-reference is required.");
  }

  const runtime = await providerConfigResolver.resolveByCode("SHIPROCKET");

  const result = await runShiprocketLiveLifecycle(
    {
      bookingService,
      cancellationService,
      adapterExecutor: providerAdapterExecutor,
      deliveryRepo: deliveryRepository,
      bookingRepo: bookingRepository,
      cancellationRepo: cancellationRepository,
      orchestrationRepo: orchestrationRepository,
      paymentRepo: paymentRepository,
      providerRepo: providerRepository,
    },
    {
      dryRun,
      runId,
      deliveryId,
      deliveryReference,
      confirmLiveHost: values["confirm-live-host"],
      confirmCancel: values["confirm-cancel"],
      shiprocketEnabled: env.SHIPROCKET_ENABLED,
      shiprocketBookingEnabled: env.SHIPROCKET_BOOKING_ENABLED,
      pickupLocation: env.SHIPROCKET_PICKUP_LOCATION,
      provider: {
        code: runtime.providerCode,
        environment: runtime.environment,
        baseUrl: runtime.baseUrl,
        providerId: runtime.providerId,
      },
    },
  );

  console.log(
    JSON.stringify(
      {
        ...result,
        note: dryRun
          ? "No live Shiprocket HTTP calls were made in dry-run."
          : "Live execute completed or stopped with recorded artifacts.",
      },
      null,
      2,
    ),
  );

  if (!result.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Runner failed.",
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
