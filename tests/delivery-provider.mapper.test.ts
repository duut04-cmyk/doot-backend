import { describe, expect, it } from "vitest";
import {
  toAvailabilityRequest,
  toBookingRequest,
  toQuoteRequest,
  toServiceabilityRequest,
} from "../src/modules/provider/adapters/delivery-provider.mapper.js";
import type { DeliveryDetailDto } from "../src/modules/delivery/delivery.types.js";
import { phoneValue } from "./helpers/phone-test-helpers.js";

const delivery: DeliveryDetailDto = {
  id: "11111111-1111-1111-1111-111111111111",
  reference: "DOTT-2000",
  status: "CREATED",
  pickup: {
    addressText: "12 MG Road",
    contactName: "Riya",
    contactPhone: phoneValue("+91", "9876543210"),
    instructions: "Gate 2",
    latitude: 12.9716,
    longitude: 77.5946,
  },
  drop: {
    addressText: "88 Indiranagar",
    contactName: "Aman",
    contactPhone: phoneValue("+91", "9811122233"),
    instructions: null,
    latitude: null,
    longitude: null,
  },
  package: {
    packageType: "FOOD",
    description: "Meal",
    weightKg: 1.5,
    lengthCm: 20,
    widthCm: 15,
    heightCm: 10,
    sizeTier: "MEDIUM",
    quantity: 1,
    photos: [],
  },
  requirements: ["HANDLE_WITH_CARE"],
  specialInstructions: "Call on arrival",
  schedule: {
    mode: "ASAP",
    timezone: "Asia/Kolkata",
    scheduledAt: null,
    windowStart: null,
    windowEnd: null,
  },
  compliance: {
    accepted: true,
    acceptedAt: "2026-09-14T10:00:00.000Z",
  },
  createdAt: "2026-09-14T10:00:00.000Z",
  updatedAt: "2026-09-14T10:00:00.000Z",
};

describe("Delivery to provider mapper", () => {
  it("maps delivery to serviceability request with optional coordinates", () => {
    const request = toServiceabilityRequest(delivery);
    expect(request.deliveryId).toBe(delivery.id);
    expect(request.pickup.addressText).toBe("12 MG Road");
    expect(request.pickup.contactPhoneCountryCode).toBe("+91");
    expect(request.pickup.contactPhoneNumber).toBe("9876543210");
    expect(request.pickup.latitude).toBe(12.9716);
    expect(request.pickup.longitude).toBe(77.5946);
    expect(request.drop.latitude).toBeNull();
    expect(request.drop.longitude).toBeNull();
    expect(request.package.weightKg).toBe(1.5);
    expect(request.schedule.mode).toBe("ASAP");
    expect(request.requirements).toEqual(["HANDLE_WITH_CARE"]);
  });

  it("maps quote and booking requests with optional service code", () => {
    const quote = toQuoteRequest(delivery, { serviceCode: "MOCK_BIKE" });
    expect(quote.serviceCode).toBe("MOCK_BIKE");

    const booking = toBookingRequest(delivery, {
      serviceCode: "MOCK_BIKE",
      providerQuoteId: "Q-1",
      idempotencyKey: "idem-1",
    });
    expect(booking.providerQuoteId).toBe("Q-1");
    expect(booking.idempotencyKey).toBe("idem-1");
  });

  it("maps availability request", () => {
    const availability = toAvailabilityRequest(delivery);
    expect(availability.deliveryReference).toBe("DOTT-2000");
  });
});
