import { describe, expect, it } from "vitest";
import { MockProviderAdapter } from "../src/modules/provider/adapters/mock/mock-provider.adapter.js";
import { MOCK_BOOKING_ID } from "../src/modules/provider/adapters/mock/mock-provider.constants.js";
import type { ProviderRuntimeConfig } from "../src/modules/provider/adapters/provider-config.types.js";
import { storedPhone } from "./helpers/phone-test-helpers.js";

const ctx = (requestId = "mock-ctx-1") => ({
  requestId,
  config: {
    providerId: "p-1",
    providerCode: "MOCK",
    environment: "SANDBOX",
    status: "ACTIVE",
    enabled: true,
    integrationStatus: "READY",
    baseUrl: "https://mock-provider.test/sandbox",
    timeoutMs: 30000,
    connectTimeoutMs: 10000,
    maxRetries: 2,
    retryDelayMs: 1000,
    capabilities: [],
    services: [],
    credentials: {},
  } satisfies ProviderRuntimeConfig,
});

const baseRequest = {
  pickup: {
    addressText: "A",
    contactName: "A",
    ...storedPhone("+91", "1111111111"),
  },
  drop: {
    addressText: "B",
    contactName: "B",
    ...storedPhone("+91", "2222222222"),
  },
  package: {
    packageType: "FOOD" as const,
    weightKg: 1,
    quantity: 1,
  },
  schedule: { mode: "ASAP" as const, timezone: "Asia/Kolkata" },
  requirements: [] as string[],
};

describe("MockProviderAdapter", () => {
  const adapter = new MockProviderAdapter();

  it("exposes adapter metadata", () => {
    expect(adapter.metadata.providerCode).toBe("MOCK");
    expect(adapter.supportsOperation("getQuote")).toBe(true);
    expect(adapter.supportsOperation("healthCheck")).toBe(true);
  });

  it("returns deterministic webhook normalization without secrets", async () => {
    const event = await adapter.execute(
      "parseWebhook",
      {
        body: {
          eventId: "evt-1",
          eventType: "DELIVERED",
          bookingId: "b-1",
          apiKey: "super-secret",
        },
      },
      ctx(),
    );
    expect(event.eventType).toBe("DELIVERED");
    expect(JSON.stringify(event)).not.toContain("super-secret");
  });

  it("returns health check healthy in tests", async () => {
    const health = await adapter.execute("healthCheck", {}, ctx());
    expect(health.healthy).toBe(true);
  });

  it("handles unavailable serviceability for invalid weight", async () => {
    const result = await adapter.execute(
      "checkServiceability",
      {
        ...baseRequest,
        package: { ...baseRequest.package, weightKg: -1 },
      },
      ctx(),
    );
    expect(result.serviceable).toBe(false);
  });

  it("returns normalized tracking with mock tracking URL and status", async () => {
    const tracking = await adapter.execute(
      "getTracking",
      { providerBookingId: MOCK_BOOKING_ID },
      ctx("mock-tracking-1"),
    );

    expect(tracking.status).toBe("IN_TRANSIT");
    expect(tracking.trackingUrl).toBe(
      `https://mock-provider.test/track/${MOCK_BOOKING_ID}`,
    );
    expect(tracking.trackingUrl).toContain("mock-provider.test");
    expect(tracking.providerEventId).toMatch(/^MOCK-EVENT-/);
    expect(tracking.latitude).toBeNull();
    expect(tracking.longitude).toBeNull();
  });

  it("includes coordinates when testHints request them", async () => {
    const tracking = await adapter.execute(
      "getTracking",
      { providerBookingId: MOCK_BOOKING_ID },
      {
        ...ctx("mock-tracking-2"),
        testHints: { includeTrackingCoordinates: true },
      },
    );

    expect(tracking.latitude).toBe(12.9716);
    expect(tracking.longitude).toBe(77.5946);
  });

  it("declares LIVE_TRACKING and TRACKING_URL capabilities in metadata", () => {
    expect(adapter.metadata.supportedCapabilities).toEqual(
      expect.arrayContaining(["LIVE_TRACKING", "TRACKING_URL"]),
    );
  });
});
