import { describe, expect, it } from "vitest";
import { BorzoAdapter } from "../src/modules/provider/adapters/borzo/borzo.adapter.js";
import { BORZO_TEST_BASE_URL } from "../src/modules/provider/adapters/borzo/borzo.constants.js";
import type { ProviderRuntimeConfig } from "../src/modules/provider/adapters/provider-config.types.js";

const e2eEnabled = process.env.BORZO_E2E_ENABLED === "true";
const accessToken = process.env.BORZO_ACCESS_TOKEN?.trim();

function buildE2EConfig(): ProviderRuntimeConfig {
  if (!accessToken) {
    throw new Error("BORZO_ACCESS_TOKEN is required when BORZO_E2E_ENABLED=true.");
  }

  return {
    providerId: "00000000-0000-0000-0000-00000000e2e0",
    providerCode: "BORZO",
    environment: "SANDBOX",
    status: "ACTIVE",
    enabled: true,
    integrationStatus: "CONFIGURED",
    baseUrl: BORZO_TEST_BASE_URL,
    timeoutMs: 45000,
    connectTimeoutMs: 15000,
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
    credentials: { ACCESS_TOKEN: accessToken },
  };
}

const testDelivery = {
  pickup: {
    addressText: "Saket, New Delhi, Delhi",
    contactName: "Dutt E2E Test",
    contactPhoneCountryCode: "+91",
    contactPhoneNumber: "9880000001",
  },
  drop: {
    addressText: "Janakpuri, New Delhi, Delhi",
    contactName: "Dutt E2E Test",
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

describe.skipIf(!e2eEnabled)("Borzo TEST API E2E", () => {
  it("authenticates against Borzo TEST", async () => {
    const adapter = new BorzoAdapter();
    const config = buildE2EConfig();
    const health = await adapter.execute("healthCheck", undefined, {
      requestId: `e2e-health-${Date.now()}`,
      config,
    });
    expect(health.healthy).toBe(true);
  });

  it("runs calculate-order against Borzo TEST", async () => {
    const adapter = new BorzoAdapter();
    const config = buildE2EConfig();
    const quote = await adapter.execute("getQuote", testDelivery, {
      requestId: `e2e-quote-${Date.now()}`,
      config,
    });
    expect(quote.available).toBe(true);
    expect(quote.amount?.amount).toBeGreaterThan(0);
  });

  it("creates, tracks, and cancels a TEST order", async () => {
    const adapter = new BorzoAdapter();
    const config = buildE2EConfig();
    const requestId = `e2e-booking-${Date.now()}`;

    const booking = await adapter.execute(
      "createBooking",
      {
        ...testDelivery,
        deliveryId: "00000000-0000-0000-0000-00000000e2e2",
        deliveryReference: `DUTT-E2E-${Date.now()}`,
        idempotencyKey: `e2e-${Date.now()}`.slice(0, 32),
      },
      { requestId, config },
    );

    expect(booking.success).toBe(true);
    expect(booking.providerBookingId).toBeTruthy();

    const tracking = await adapter.execute(
      "getTracking",
      { providerBookingId: booking.providerBookingId! },
      { requestId: `${requestId}-track`, config },
    );
    expect(tracking.status).toBeTruthy();

    const cancellation = await adapter.execute(
      "cancelBooking",
      {
        providerBookingId: booking.providerBookingId!,
        reason: "Dutt E2E cleanup",
      },
      { requestId: `${requestId}-cancel`, config },
    );
    expect(cancellation.success).toBe(true);
    expect(cancellation.outcome).toBe("CANCELLED");
  }, 120_000);
});
