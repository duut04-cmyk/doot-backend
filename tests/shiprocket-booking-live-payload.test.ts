import { describe, expect, it, vi } from "vitest";

vi.mock("../src/config/env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config/env.js")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      SHIPROCKET_PICKUP_LOCATION: "Doot Live Test Pickup",
    },
  };
});
import type { BookingRequest } from "../src/modules/provider/contracts/booking.js";
import {
  buildShiprocketAdhocOrderPayload,
  resolveShiprocketPostcodePincode,
} from "../src/modules/provider/adapters/shiprocket/shiprocket-booking-payload.js";
import { ProviderAdapterError } from "../src/modules/provider/contracts/provider-error.js";

const baseRequest: BookingRequest = {
  deliveryReference: "DOOT-LIVE-REF",
  pickup: {
    addressText: "Pickup line",
    contactName: "Pickup Contact",
    contactPhoneCountryCode: "+91",
    contactPhoneNumber: "9876543210",
    latitude: 19.076,
    longitude: 72.8777,
  },
  drop: {
    addressText: "Drop line",
    contactName: "Drop Contact",
    contactPhoneCountryCode: "+91",
    contactPhoneNumber: "9811122233",
    latitude: 19.08,
    longitude: 72.88,
  },
  package: {
    packageType: "PARCEL",
    weightKg: 1,
    quantity: 1,
  },
  schedule: { mode: "ASAP", timezone: "Asia/Kolkata" },
  providerQuoteId: "501",
  providerMetadata: {
    shiprocketHyperlocalRate: { courier_id: 501, rates: 120 },
    shiprocketPickupPostcode: "400001",
    shiprocketDeliveryPostcode: "400050",
    shiprocketPickupCity: "Mumbai",
    shiprocketPickupState: "Maharashtra",
    shiprocketDeliveryCity: "Mumbai",
    shiprocketDeliveryState: "Maharashtra",
    shiprocketBillingEmail: "billing@example.test",
  },
};

describe("Shiprocket live booking payload validation", () => {
  it("allows sandbox fallbacks when strictLive is false", () => {
    const payload = buildShiprocketAdhocOrderPayload({
      request: {
        ...baseRequest,
        providerMetadata: {
          shiprocketHyperlocalRate: { courier_id: 501, rates: 99 },
        },
      },
      strictLive: false,
    });
    expect(payload.billing_pincode).toBe(110001);
    expect(payload.billing_city).toBe("NA");
    expect(payload.billing_email).toBe("booking@doot.local");
  });

  it("rejects missing pickup PIN for live", () => {
    expect(() =>
      resolveShiprocketPostcodePincode({
        metadata: {},
        metadataKey: "shiprocketPickupPostcode",
        strictLive: true,
        label: "Pickup",
      }),
    ).toThrow(ProviderAdapterError);
  });

  it("rejects missing city/state for live", () => {
    expect(() =>
      buildShiprocketAdhocOrderPayload({
        request: {
          ...baseRequest,
          providerMetadata: {
            ...baseRequest.providerMetadata,
            shiprocketPickupCity: undefined,
          },
        },
        strictLive: true,
      }),
    ).toThrow(/Pickup city is required/);
  });

  it("rejects missing billing email for live", () => {
    expect(() =>
      buildShiprocketAdhocOrderPayload({
        request: {
          ...baseRequest,
          providerMetadata: {
            ...baseRequest.providerMetadata,
            shiprocketBillingEmail: undefined,
          },
        },
        strictLive: true,
      }),
    ).toThrow(/shiprocketBillingEmail/);
  });

  it("rejects missing pickup coordinates for live", () => {
    expect(() =>
      buildShiprocketAdhocOrderPayload({
        request: {
          ...baseRequest,
          pickup: { ...baseRequest.pickup, latitude: null, longitude: null },
        },
        strictLive: true,
      }),
    ).toThrow(/Pickup coordinates/);
  });

  it("builds complete live payload with validated metadata", () => {
    const payload = buildShiprocketAdhocOrderPayload({
      request: baseRequest,
      strictLive: true,
    });
    expect(payload.billing_pincode).toBe(400001);
    expect(payload.shipping_pincode).toBe(400050);
    expect(payload.billing_city).toBe("Mumbai");
    expect(payload.billing_state).toBe("Maharashtra");
    expect(payload.billing_email).toBe("billing@example.test");
    expect(payload.payment_method).toBe("Prepaid");
  });
});
