import { describe, expect, it } from "vitest";
import {
  toAvailabilityRequest,
  toBookingRequest,
  toQuoteRequest,
  toServiceabilityRequest,
} from "../src/modules/provider/adapters/delivery-provider.mapper.js";
import type { DeliveryDetailDto } from "../src/modules/delivery/delivery.types.js";

const delivery: DeliveryDetailDto = {
  id: "11111111-1111-1111-1111-111111111111",
  reference: "DUTT-2000",
  status: "CREATED",
  pickup: {
    addressText: "12 MG Road",
    contactName: "Riya",
    contactPhone: "+919876543210",
    instructions: "Gate 2",
  },
  drop: {
    addressText: "88 Indiranagar",
    contactName: "Aman",
    contactPhone: "+919811122233",
    instructions: null,
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
  it("maps delivery to serviceability request without geo", () => {
    const request = toServiceabilityRequest(delivery);
    expect(request.deliveryId).toBe(delivery.id);
    expect(request.pickup.addressText).toBe("12 MG Road");
    expect(request.package.weightKg).toBe(1.5);
    expect(request.schedule.mode).toBe("ASAP");
    expect(request.requirements).toEqual(["HANDLE_WITH_CARE"]);
    expect(request.pickup).not.toHaveProperty("latitude");
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
    expect(availability.deliveryReference).toBe("DUTT-2000");
  });
});
