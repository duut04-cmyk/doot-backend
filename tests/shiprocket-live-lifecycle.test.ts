import { describe, expect, it, vi } from "vitest";

vi.mock("../src/config/env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config/env.js")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      SHIPROCKET_ENABLED: true,
      SHIPROCKET_BOOKING_ENABLED: true,
      SHIPROCKET_PICKUP_LOCATION: "Doot Live Test Pickup",
    },
  };
});
import type { BookingRequest } from "../src/modules/provider/contracts/booking.js";
import { ProviderHttpClient } from "../src/modules/provider/adapters/provider-http-client.js";
import type { ProviderRuntimeConfig } from "../src/modules/provider/adapters/provider-config.types.js";
import { ShiprocketBookingService } from "../src/modules/provider/adapters/shiprocket/shiprocket-booking.service.js";
import {
  redactArtifactJson,
  setShiprocketLiveLifecycleArtifactRecorder,
} from "../src/modules/provider/adapters/shiprocket/shiprocket-live-lifecycle-artifacts.js";
import {
  assertShiprocketLiveCancelConfirmation,
  assertShiprocketLiveHostConfirmation,
  assertShiprocketProductionBaseUrl,
  assertShiprocketProviderLiveEnvironment,
  SHIPROCKET_LIVE_CANCEL_CONFIRM_PHRASE,
  SHIPROCKET_LIVE_HOST_CONFIRM_PHRASE,
  ShiprocketLiveLifecycleGuardError,
} from "../src/modules/provider/adapters/shiprocket/shiprocket-live-lifecycle.guards.js";
import { runShiprocketLiveLifecyclePreflight } from "../src/modules/provider/adapters/shiprocket/shiprocket-live-lifecycle-runner.lib.js";

const liveBookingRequest: BookingRequest = {
  deliveryReference: "DOOT-LIVE-1",
  pickup: {
    addressText: "Pickup",
    contactName: "A",
    contactPhoneCountryCode: "+91",
    contactPhoneNumber: "9876543210",
    latitude: 19.0,
    longitude: 72.8,
  },
  drop: {
    addressText: "Drop",
    contactName: "B",
    contactPhoneCountryCode: "+91",
    contactPhoneNumber: "9811122233",
    latitude: 19.01,
    longitude: 72.81,
  },
  package: { packageType: "PARCEL", weightKg: 1, quantity: 1 },
  schedule: { mode: "ASAP", timezone: "Asia/Kolkata" },
  providerQuoteId: "77",
  providerMetadata: {
    shiprocketHyperlocalRate: { courier_id: 77, rates: 100 },
    shiprocketPickupPostcode: "400001",
    shiprocketDeliveryPostcode: "400050",
    shiprocketPickupCity: "Mumbai",
    shiprocketPickupState: "Maharashtra",
    shiprocketDeliveryCity: "Mumbai",
    shiprocketDeliveryState: "Maharashtra",
    shiprocketBillingEmail: "ops@example.test",
  },
};

describe("Shiprocket live lifecycle guards", () => {
  it("rejects missing production confirmation", () => {
    expect(() =>
      assertShiprocketLiveHostConfirmation({ confirmPhrase: undefined }),
    ).toThrow(ShiprocketLiveLifecycleGuardError);
  });

  it("accepts production confirmation phrase", () => {
    expect(() =>
      assertShiprocketLiveHostConfirmation({
        confirmPhrase: SHIPROCKET_LIVE_HOST_CONFIRM_PHRASE,
      }),
    ).not.toThrow();
  });

  it("rejects sandbox host for live lifecycle", () => {
    expect(() =>
      assertShiprocketProductionBaseUrl("https://api-sandbox.shiprocket.in"),
    ).toThrow(/Sandbox host/);
  });

  it("accepts trusted production host", () => {
    expect(() =>
      assertShiprocketProductionBaseUrl("https://apiv2.shiprocket.in"),
    ).not.toThrow();
  });

  it("requires LIVE provider environment", () => {
    expect(() =>
      assertShiprocketProviderLiveEnvironment({
        providerCode: "SHIPROCKET",
        environment: "SANDBOX",
      }),
    ).toThrow(/LIVE/);
  });

  it("requires separate cancel confirmation", () => {
    expect(() =>
      assertShiprocketLiveCancelConfirmation({ confirmPhrase: "no" }),
    ).toThrow(ShiprocketLiveLifecycleGuardError);
    expect(() =>
      assertShiprocketLiveCancelConfirmation({
        confirmPhrase: SHIPROCKET_LIVE_CANCEL_CONFIRM_PHRASE,
      }),
    ).not.toThrow();
  });
});

describe("Shiprocket live lifecycle preflight", () => {
  it("passes dry-run preflight without production-host confirmation or HTTP", () => {
    const result = runShiprocketLiveLifecyclePreflight({
      dryRun: true,
      deliveryReference: "DOOT-UNIQUE-REF",
      shiprocketEnabled: true,
      shiprocketBookingEnabled: true,
      pickupLocation: "Doot Pickup",
      provider: { code: "SHIPROCKET", environment: "LIVE" },
      bookingRequest: liveBookingRequest,
    });
    expect(result.ok).toBe(true);
    expect(result.checks).toContain("live_booking_payload");
    expect(result.checks).not.toContain("live_host_confirmation");
  });

  it("requires production-host confirmation for execute preflight", () => {
    expect(() =>
      runShiprocketLiveLifecyclePreflight({
        dryRun: false,
        deliveryReference: "DOOT-UNIQUE-REF",
        shiprocketEnabled: true,
        shiprocketBookingEnabled: true,
        pickupLocation: "Doot Pickup",
        provider: { code: "SHIPROCKET", environment: "LIVE" },
        bookingRequest: liveBookingRequest,
      }),
    ).toThrow(ShiprocketLiveLifecycleGuardError);
  });

  it("preflight succeeds for execute flag without throwing (mutations gated elsewhere)", () => {
    const result = runShiprocketLiveLifecyclePreflight({
      dryRun: false,
      confirmLiveHost: SHIPROCKET_LIVE_HOST_CONFIRM_PHRASE,
      deliveryReference: "DOOT-UNIQUE-REF",
      shiprocketEnabled: true,
      shiprocketBookingEnabled: true,
      pickupLocation: "Doot Pickup",
      provider: { code: "SHIPROCKET", environment: "LIVE" },
      bookingRequest: liveBookingRequest,
    });
    expect(result.dryRun).toBe(false);
  });

  it("rejects preflight when booking flags disabled", () => {
    expect(() =>
      runShiprocketLiveLifecyclePreflight({
        dryRun: true,
        confirmLiveHost: SHIPROCKET_LIVE_HOST_CONFIRM_PHRASE,
        deliveryReference: "DOOT-UNIQUE-REF",
        shiprocketEnabled: false,
        shiprocketBookingEnabled: false,
        pickupLocation: "Doot Pickup",
        provider: { code: "SHIPROCKET", environment: "LIVE" },
      }),
    ).toThrow(/SHIPROCKET_ENABLED/);
  });
});

describe("Shiprocket live lifecycle artifacts", () => {
  it("redacts secrets and contact fields but preserves structure", () => {
    const redacted = redactArtifactJson({
      authorization: "secret",
      billing_phone: "9876543210",
      billing_address: "Secret street 1",
      billing_pincode: "400001",
      billing_city: "Mumbai",
      nested: { token: "abc", order_id: 12345 },
    }) as Record<string, unknown>;
    expect(redacted.authorization).toBe("[REDACTED]");
    expect(redacted.billing_address).toBe("[REDACTED_ADDRESS]");
    expect(redacted.billing_pincode).toBe("400001");
    expect(redacted.billing_city).toBe("Mumbai");
    expect((redacted.nested as Record<string, unknown>).token).toBe("[REDACTED]");
    expect((redacted.nested as Record<string, unknown>).order_id).toBe(12345);
  });
});

describe("Shiprocket create idempotency on ambiguous create", () => {
  it("does not POST create twice when order-show finds existing order after error", async () => {
    let createPosts = 0;
    let showCalls = 0;
    const http = {
      request: vi.fn(async (input: { request: { method: string; path: string } }) => {
        if (
          input.request.method === "POST" &&
          input.request.path.includes("create/adhoc")
        ) {
          createPosts += 1;
          return { status: 500, data: { message: "fail" }, headers: {}, durationMs: 1 };
        }
        if (input.request.path.includes("orders/show")) {
          showCalls += 1;
          if (showCalls === 1) {
            return { status: 404, data: {}, headers: {}, durationMs: 1 };
          }
          return {
            status: 200,
            data: {
              data: {
                id: 999,
                status: "NEW",
                shipment_id: 888,
                shipments: [{ id: 888, awb: "SR123456789IN" }],
              },
            },
            headers: {},
            durationMs: 1,
          };
        }
        if (input.request.path.includes("assign/awb")) {
          return {
            status: 200,
            data: { awb_code: "SR123456789IN" },
            headers: {},
            durationMs: 1,
          };
        }
        return { status: 404, data: {}, headers: {}, durationMs: 1 };
      }),
    };

    const auth = { getBearerToken: vi.fn(async () => "token") };
    const service = new ShiprocketBookingService(http as never, auth as never);
    const config: ProviderRuntimeConfig = {
      providerId: "p1",
      providerCode: "SHIPROCKET",
      environment: "SANDBOX",
      status: "ACTIVE",
      enabled: true,
      integrationStatus: "READY",
      baseUrl: "https://api-sandbox.shiprocket.in",
      timeoutMs: 5000,
      connectTimeoutMs: 5000,
      maxRetries: 0,
      retryDelayMs: 0,
      capabilities: ["BOOKING"],
      services: [],
      credentials: {},
    };

    const result = await service.createBooking(liveBookingRequest, {
      config,
      requestId: "req-idem",
      requireReady: true,
    });

    expect(createPosts).toBe(1);
    expect(result.outcome).toBe("BOOKED");
    setShiprocketLiveLifecycleArtifactRecorder(null);
  });
});

describe("Shiprocket cancellation guardrails", () => {
  it("returns UNKNOWN from cancel preflight indeterminate without POST cancel", async () => {
    const http = {
      request: vi.fn(async () => {
        throw new Error("cancel POST must not be called");
      }),
    };
    const auth = { getBearerToken: vi.fn(async () => "token") };
    const { ShiprocketLifecycleService } =
      await import("../src/modules/provider/adapters/shiprocket/shiprocket-lifecycle.service.js");
    const service = new ShiprocketLifecycleService(http as never, auth as never);

    vi.spyOn(service as never, "loadOrderShowDetails" as never).mockResolvedValue({
      orderId: "12345",
      channelOrderId: null,
      status: "UNKNOWN",
      statusCode: null,
      subStatus: null,
      shipmentId: "999",
      awbCode: "SR123456789IN",
      courierName: null,
      courierId: null,
      shipmentStatus: null,
      estimatedDelivery: null,
      deliveredDate: null,
    });

    const result = await service.cancelBooking(
      { providerBookingId: "12345", reason: "test" },
      {
        config: {
          providerId: "p1",
          providerCode: "SHIPROCKET",
          environment: "LIVE",
          status: "ACTIVE",
          enabled: true,
          integrationStatus: "READY",
          baseUrl: "https://apiv2.shiprocket.in",
          timeoutMs: 5000,
          connectTimeoutMs: 5000,
          maxRetries: 0,
          retryDelayMs: 0,
          capabilities: ["CANCELLATION"],
          services: [],
          credentials: {},
        },
        requestId: "req-cancel-unknown",
        requireReady: true,
      },
    );

    expect(result.outcome).toBe("UNKNOWN");
    expect(http.request).not.toHaveBeenCalled();
  });
});

describe("ProviderHttpClient live artifact hook", () => {
  it("records exchanges when recorder is active", async () => {
    const writes: unknown[] = [];
    setShiprocketLiveLifecycleArtifactRecorder({
      runId: "test-run",
      runDirectory: "/tmp/test",
      recordHttpExchange: async (exchange) => {
        writes.push(exchange);
      },
      recordDbSnapshot: async () => {},
    });

    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ order_id: 1, shipment_id: 2 }), { status: 200 }),
    );
    const client = new ProviderHttpClient(fetchMock as never);
    const config: ProviderRuntimeConfig = {
      providerId: "p1",
      providerCode: "SHIPROCKET",
      environment: "LIVE",
      status: "ACTIVE",
      enabled: true,
      integrationStatus: "READY",
      baseUrl: "https://apiv2.shiprocket.in",
      timeoutMs: 5000,
      connectTimeoutMs: 0,
      maxRetries: 0,
      retryDelayMs: 0,
      capabilities: [],
      services: [],
      credentials: {},
    };

    await client.request({
      config,
      operation: "createBooking",
      requestId: "req-artifact",
      request: {
        method: "POST",
        path: "/v1/external/orders/create/adhoc",
        body: { order_id: "X1" },
      },
    });

    expect(writes.length).toBe(1);
    expect((writes[0] as { outcome: string }).outcome).toBe("success");
    setShiprocketLiveLifecycleArtifactRecorder(null);
  });
});

describe("Shiprocket live lifecycle artifact redaction", () => {
  it("redacts nested contact objects while preserving operational ids", () => {
    const redacted = redactArtifactJson({
      order_id: 12345,
      billing_pincode: 400001,
      billing_city: "Mumbai",
      billing_state: "Maharashtra",
      billing_customer_name: "Alice Customer",
      billing_phone: 9876543210,
      billing_email: "alice@example.test",
      billing_address: "Secret Street 1",
      latitude: 19.07,
      longitude: 72.87,
      pickup: {
        contact_name: "Pickup Person",
        phone: "9998887776",
        address: "Hidden pickup lane",
      },
      order_items: [
        { name: "Parcel contents", sku: "DOOT-PARCEL", selling_price: 150 },
      ],
      courier_name: "Quick Courier",
    }) as Record<string, unknown>;

    expect(redacted.order_id).toBe(12345);
    expect(redacted.billing_pincode).toBe(400001);
    expect(redacted.billing_city).toBe("Mumbai");
    expect(redacted.latitude).toBe("[REDACTED_COORD]");
    expect(redacted.billing_address).toBe("[REDACTED_ADDRESS]");
    expect((redacted.pickup as Record<string, unknown>).address).toBe(
      "[REDACTED_ADDRESS]",
    );
    expect((redacted.order_items as Array<Record<string, unknown>>)[0]?.name).toBe(
      "Parcel contents",
    );
    expect(redacted.courier_name).toBe("Quick Courier");
  });
});
