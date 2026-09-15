/**
 * Optional manual Borzo sandbox smoke test.
 *
 * Usage:
 *   BORZO_SANDBOX_SMOKE_TEST=true BORZO_ACCESS_TOKEN=... npx tsx scripts/borzo-sandbox-smoke.ts
 *
 * Never prints credentials.
 */
import { BorzoClient } from "../src/modules/provider/adapters/borzo/borzo.client.js";
import { BORZO_TEST_BASE_URL } from "../src/modules/provider/adapters/borzo/borzo.constants.js";
import {
  mapBorzoCalculateOrderToProbeResult,
  mapQuoteRequestToBorzoCalculateOrder,
} from "../src/modules/provider/adapters/borzo/borzo.mapper.js";
import type { ProviderRuntimeConfig } from "../src/modules/provider/adapters/provider-config.types.js";

async function main() {
  if (process.env.BORZO_SANDBOX_SMOKE_TEST !== "true") {
    process.stdout.write("Set BORZO_SANDBOX_SMOKE_TEST=true to run this script.\n");
    process.exit(0);
  }

  const token = process.env.BORZO_ACCESS_TOKEN?.trim();
  if (!token) {
    console.error("BORZO_ACCESS_TOKEN is required for sandbox smoke test.");
    process.exit(1);
  }

  const config: ProviderRuntimeConfig = {
    providerId: "00000000-0000-0000-0000-000000000001",
    providerCode: "BORZO",
    environment: "SANDBOX",
    status: "ACTIVE",
    enabled: true,
    integrationStatus: "CONFIGURED",
    baseUrl: BORZO_TEST_BASE_URL,
    timeoutMs: 30000,
    connectTimeoutMs: 10000,
    maxRetries: 0,
    retryDelayMs: 1000,
    capabilities: ["PRICING", "SERVICEABILITY"],
    services: [],
    credentials: { ACCESS_TOKEN: token },
  };

  const client = new BorzoClient();
  const requestId = `smoke-${Date.now()}`;

  const ping = await client.ping({ config, requestId });
  process.stdout.write(
    `${JSON.stringify(
      {
        step: "connection",
        connected: ping.healthy,
        latencyMs: ping.durationMs,
      },
      null,
      2,
    )}\n`,
  );

  const quoteRequest = mapQuoteRequestToBorzoCalculateOrder({
    pickup: {
      addressText: "Saket, New Delhi, Delhi",
      contactName: "Smoke Test",
      contactPhoneCountryCode: "+91",
      contactPhoneNumber: "9880000001",
    },
    drop: {
      addressText: "Janakpuri, New Delhi, Delhi",
      contactName: "Smoke Test",
      contactPhoneCountryCode: "+91",
      contactPhoneNumber: "9880000002",
    },
    package: {
      packageType: "DOCUMENT",
      weightKg: 1,
      quantity: 1,
    },
    schedule: {
      mode: "ASAP",
      timezone: "Asia/Kolkata",
    },
    requirements: [],
  });

  const raw = await client.calculateOrder({
    config,
    requestId,
    body: quoteRequest,
  });

  const normalized = mapBorzoCalculateOrderToProbeResult(raw, {
    pickup: {
      addressText: "Saket, New Delhi, Delhi",
      contactName: "Smoke Test",
      contactPhoneCountryCode: "+91",
      contactPhoneNumber: "9880000001",
    },
    drop: {
      addressText: "Janakpuri, New Delhi, Delhi",
      contactName: "Smoke Test",
      contactPhoneCountryCode: "+91",
      contactPhoneNumber: "9880000002",
    },
    package: {
      packageType: "DOCUMENT",
      weightKg: 1,
      quantity: 1,
    },
    schedule: {
      mode: "ASAP",
      timezone: "Asia/Kolkata",
    },
    requirements: [],
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        step: "calculate-order",
        providerSuccessful: raw.is_successful,
        normalized: {
          quoteAvailable: normalized.quote.available,
          amount: normalized.quote.amount,
          serviceable: normalized.serviceability.serviceable,
          availabilityKnown: normalized.availability.available,
          warnings: normalized.warnings,
          providerMetadata: normalized.providerMetadata,
        },
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  console.error("Borzo sandbox smoke test failed.");
  if (error instanceof Error) {
    console.error(error.message);
  }
  process.exit(1);
});
