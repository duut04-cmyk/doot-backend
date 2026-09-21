/**
 * Optional manual Borzo TEST operational smoke test.
 *
 * Usage:
 *   BORZO_SANDBOX_SMOKE_TEST=true BORZO_ACCESS_TOKEN=... npx tsx scripts/borzo-operational-smoke.ts
 *
 * Creates a real TEST order and cancels it when supported. Never prints credentials.
 */
import { BorzoAdapter } from "../src/modules/provider/adapters/borzo/borzo.adapter.js";
import { BORZO_TEST_BASE_URL } from "../src/modules/provider/adapters/borzo/borzo.constants.js";
import type { ProviderRuntimeConfig } from "../src/modules/provider/adapters/provider-config.types.js";

function logStep(step: string, payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ step, ...payload }, null, 2)}\n`);
}

async function main() {
  if (process.env.BORZO_SANDBOX_SMOKE_TEST !== "true") {
    process.stdout.write(
      "Set BORZO_SANDBOX_SMOKE_TEST=true to run this script.\n",
    );
    process.exit(0);
  }

  const token = process.env.BORZO_ACCESS_TOKEN?.trim();
  if (!token) {
    console.error("BORZO_ACCESS_TOKEN is required for operational smoke test.");
    process.exit(1);
  }

  const config: ProviderRuntimeConfig = {
    providerId: "00000000-0000-0000-0000-000000000002",
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
    capabilities: [
      "PRICING",
      "SERVICEABILITY",
      "BOOKING",
      "CANCELLATION",
      "LIVE_TRACKING",
      "WEBHOOKS",
    ],
    services: [],
    credentials: { ACCESS_TOKEN: token },
  };

  const adapter = new BorzoAdapter();
  const requestId = `operational-smoke-${Date.now()}`;
  const ctx = { requestId, config };

  const health = await adapter.execute("healthCheck", undefined, ctx);
  logStep("connection", {
    connected: health.healthy,
    checkedAt: health.checkedAt,
  });

  const quoteRequest = {
    pickup: {
      addressText: "Saket, New Delhi, Delhi",
      contactName: "Dutt Integration Test",
      contactPhoneCountryCode: "+91",
      contactPhoneNumber: "9880000001",
    },
    drop: {
      addressText: "Janakpuri, New Delhi, Delhi",
      contactName: "Dutt Integration Test",
      contactPhoneCountryCode: "+91",
      contactPhoneNumber: "9880000002",
    },
    package: {
      packageType: "DOCUMENT" as const,
      weightKg: 1,
      quantity: 1,
    },
    schedule: {
      mode: "ASAP" as const,
      timezone: "Asia/Kolkata",
    },
    requirements: [],
  };

  const quote = await adapter.execute("getQuote", quoteRequest, ctx);
  logStep("calculate-order", {
    available: quote.available,
    amount: quote.amount,
    serviceable: quote.serviceable,
  });

  const bookingRequest = {
    ...quoteRequest,
    deliveryId: "00000000-0000-0000-0000-00000000e2e1",
    deliveryReference: `DUTT-SMOKE-${Date.now()}`,
    idempotencyKey: `smoke-${Date.now()}`.slice(0, 32),
  };

  const booking = await adapter.execute("createBooking", bookingRequest, ctx);
  logStep("create-order", {
    success: booking.success,
    providerBookingId: booking.providerBookingId,
    status: booking.status,
    driverPresent: booking.driver != null,
  });

  if (!booking.providerBookingId) {
    process.exit(booking.success ? 0 : 1);
  }

  const tracking = await adapter.execute(
    "getTracking",
    { providerBookingId: booking.providerBookingId },
    ctx,
  );
  logStep("tracking", {
    status: tracking.status,
    latitude: tracking.latitude,
    longitude: tracking.longitude,
    driverPresent: tracking.driver != null,
    trackingUrl: tracking.trackingUrl,
  });

  const cancellation = await adapter.execute(
    "cancelBooking",
    {
      providerBookingId: booking.providerBookingId,
      reason: "Dutt operational smoke test cleanup",
    },
    ctx,
  );
  logStep("cancel-order", {
    success: cancellation.success,
    outcome: cancellation.outcome,
    status: cancellation.status,
  });
}

main().catch((error) => {
  console.error("Borzo operational smoke test failed.");
  if (error instanceof Error) {
    console.error(error.message);
  }
  process.exit(1);
});
