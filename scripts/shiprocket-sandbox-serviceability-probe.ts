#!/usr/bin/env tsx
/**
 * Sandbox-only Shiprocket hyperlocal serviceability probe.
 * Performs login + one GET — no orders, shipments, or production hosts.
 *
 * Usage: npm run probe:shiprocket-sandbox -- [options]
 */
/* eslint-disable no-console -- probe CLI output */
import { parseArgs } from "node:util";
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

loadDotenv({ path: resolve(process.cwd(), ".env"), override: false });

if (process.env.SHIPROCKET_ENABLED !== "true") {
  process.env.SHIPROCKET_ENABLED = "true";
}

const { env } = await import("../src/config/env.js");
const { googleGeocodingClient } =
  await import("../src/infrastructure/geocoding/google-geocoding.client.js");
const {
  assertShiprocketSandboxHttpsBaseUrl,
  parseCoordinate,
  parseIndianPostcode,
  runShiprocketSandboxServiceabilityProbe,
  ShiprocketSandboxProbeError,
} =
  await import("../src/modules/provider/adapters/shiprocket/shiprocket-sandbox-probe.js");

function readOption(
  cliValue: string | undefined,
  envValue: string | undefined,
  label: string,
): string {
  const value = cliValue ?? envValue;
  if (!value?.trim()) {
    throw new ShiprocketSandboxProbeError(
      "VALIDATION",
      `${label} is required (CLI flag or environment variable).`,
    );
  }
  return value.trim();
}

function printProbeError(error: unknown): void {
  if (error instanceof ShiprocketSandboxProbeError) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          errorCode: error.code,
          message: error.message,
        },
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
        message: error instanceof Error ? error.message : "Probe failed.",
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "pickup-postcode": { type: "string" },
      "delivery-postcode": { type: "string" },
      "lat-from": { type: "string" },
      "long-from": { type: "string" },
      "lat-to": { type: "string" },
      "long-to": { type: "string" },
      weight: { type: "string" },
      cod: { type: "string", default: "0" },
      "timeout-ms": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`Shiprocket sandbox hyperlocal serviceability probe

Required (CLI or env):
  --lat-from / SHIPROCKET_PROBE_LAT_FROM
  --long-from / SHIPROCKET_PROBE_LONG_FROM
  --lat-to / SHIPROCKET_PROBE_LAT_TO
  --long-to / SHIPROCKET_PROBE_LONG_TO
  --weight / SHIPROCKET_PROBE_WEIGHT

Postcodes (optional if GOOGLE_GEOCODING_API_KEY is set):
  --pickup-postcode / SHIPROCKET_PROBE_PICKUP_POSTCODE
  --delivery-postcode / SHIPROCKET_PROBE_DELIVERY_POSTCODE

Credentials (from .env):
  SHIPROCKET_API_BASE_URL=https://api-sandbox.shiprocket.in
  SHIPROCKET_AUTH_EMAIL, SHIPROCKET_AUTH_PASSWORD

Example:
  npm run probe:shiprocket-sandbox -- \\
    --pickup-postcode 110030 --delivery-postcode 122002 \\
    --lat-from 28.509223937988 --long-from 77.067848205566 \\
    --lat-to 28.50724220275879 --long-to 77.06745147705078 \\
    --weight 1.2
`);
    process.exit(0);
  }

  const baseUrl = assertShiprocketSandboxHttpsBaseUrl(
    env.SHIPROCKET_API_BASE_URL ?? "https://api-sandbox.shiprocket.in",
  );

  const latFrom = parseCoordinate(
    readOption(values["lat-from"], process.env.SHIPROCKET_PROBE_LAT_FROM, "lat-from"),
    "lat-from",
  );
  const longFrom = parseCoordinate(
    readOption(
      values["long-from"],
      process.env.SHIPROCKET_PROBE_LONG_FROM,
      "long-from",
    ),
    "long-from",
  );
  const latTo = parseCoordinate(
    readOption(values["lat-to"], process.env.SHIPROCKET_PROBE_LAT_TO, "lat-to"),
    "lat-to",
  );
  const longTo = parseCoordinate(
    readOption(values["long-to"], process.env.SHIPROCKET_PROBE_LONG_TO, "long-to"),
    "long-to",
  );
  const weightKg = parseCoordinate(
    readOption(values.weight, process.env.SHIPROCKET_PROBE_WEIGHT, "weight"),
    "weight",
  );

  const pickupPostcodeRaw =
    values["pickup-postcode"] ?? process.env.SHIPROCKET_PROBE_PICKUP_POSTCODE;
  const deliveryPostcodeRaw =
    values["delivery-postcode"] ?? process.env.SHIPROCKET_PROBE_DELIVERY_POSTCODE;

  const timeoutMs = values["timeout-ms"]
    ? Number.parseInt(values["timeout-ms"], 10)
    : undefined;

  const result = await runShiprocketSandboxServiceabilityProbe({
    baseUrl,
    weightKg,
    cod: values.cod ?? "0",
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : undefined,
    pickup: {
      latitude: latFrom,
      longitude: longFrom,
      postcode: pickupPostcodeRaw
        ? parseIndianPostcode(pickupPostcodeRaw, "Pickup postcode")
        : undefined,
    },
    drop: {
      latitude: latTo,
      longitude: longTo,
      postcode: deliveryPostcodeRaw
        ? parseIndianPostcode(deliveryPostcodeRaw, "Delivery postcode")
        : undefined,
    },
    resolvePostcode: async ({ latitude, longitude, label }) => {
      if (!env.GOOGLE_GEOCODING_API_KEY) {
        throw new ShiprocketSandboxProbeError(
          "VALIDATION",
          `${label} postcode is required when GOOGLE_GEOCODING_API_KEY is not configured.`,
        );
      }
      const geocoded = await googleGeocodingClient.reverseGeocode(latitude, longitude);
      return geocoded.postalCode;
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        sandboxHost: result.sandboxHost,
        serviceabilityHttpStatus: result.serviceabilityHttpStatus,
        serviceabilityBody: result.serviceabilityBody,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  printProbeError(error);
  process.exit(1);
});
