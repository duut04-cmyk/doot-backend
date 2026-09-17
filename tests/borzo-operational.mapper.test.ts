import { describe, expect, it } from "vitest";
import {
  mapBorzoCancelOrderToCancellationResult,
  mapBorzoCourierToNormalizedDriver,
  mapBorzoOrderToBookingResult,
  mapBorzoTrackingResult,
  mapBookingRequestToBorzoCreateOrder,
  parseBorzoOrderId,
} from "../src/modules/provider/adapters/borzo/borzo-operational.mapper.js";
import {
  rejectedBorzoCancelOrderResponse,
  sampleBookingRequest,
  successfulBorzoCancelOrderResponse,
  successfulBorzoCreateOrderResponse,
  successfulBorzoCourierResponse,
} from "./helpers/borzo-test-fixtures.js";

describe("Borzo operational mapper", () => {
  it("maps booking request to create-order with client_order_id on first point", () => {
    const body = mapBookingRequestToBorzoCreateOrder(sampleBookingRequest);
    expect(body.points[0]?.client_order_id).toBe("dutt-test-booking-key-001");
    expect(body.matter).toBeTruthy();
    expect(body.total_weight_kg).toBe(2);
  });

  it("maps successful create-order to BOOKED result", () => {
    const result = mapBorzoOrderToBookingResult({
      response: successfulBorzoCreateOrderResponse,
      request: sampleBookingRequest,
    });
    expect(result.success).toBe(true);
    expect(result.outcome).toBe("BOOKED");
    expect(result.providerBookingId).toBe("1250100");
    expect(result.trackingUrl).toBe("https://example.test/track/1250100");
    expect(result.driver?.providerDriverId).toBe("9001");
    expect(result.driver?.name).toBe("Raj Kumar");
    expect(result.driver?.phone).toEqual({
      countryCode: "+91",
      number: "9876543210",
    });
    expect(result.amount?.amount).toBe(170);
  });

  it("maps failed create-order without fabricating booking id", () => {
    const result = mapBorzoOrderToBookingResult({
      response: { is_successful: false, errors: ["invalid_parameters"] },
      request: sampleBookingRequest,
    });
    expect(result.success).toBe(false);
    expect(result.outcome).toBe("FAILED");
    expect(result.providerBookingId).toBeNull();
  });

  it("maps courier without fabricating rating or vehicle", () => {
    const driver = mapBorzoCourierToNormalizedDriver(
      successfulBorzoCourierResponse.courier,
    );
    expect(driver?.providerRating).toBeNull();
    expect(driver?.vehicleType).toBeNull();
    expect(driver?.vehicleNumber).toBeNull();
  });

  it("returns null driver when courier payload is empty", () => {
    expect(mapBorzoCourierToNormalizedDriver(null)).toBeNull();
    expect(mapBorzoCourierToNormalizedDriver({})).toBeNull();
  });

  it("maps tracking with courier coordinates and no fabricated fallback", () => {
    const tracking = mapBorzoTrackingResult({
      order: successfulBorzoCreateOrderResponse.order,
      courierResponse: successfulBorzoCourierResponse,
      providerBookingId: "1250100",
    });
    expect(tracking.latitude).toBe(12.9716);
    expect(tracking.longitude).toBe(77.5946);
    expect(tracking.trackingUrl).toBe("https://example.test/track/1250100");
    expect(tracking.driver?.providerDriverId).toBe("9001");
  });

  it("keeps tracking coordinates null when provider omits them", () => {
    const tracking = mapBorzoTrackingResult({
      order: { order_id: 1, status: "new", points: [] },
      courierResponse: { is_successful: true, courier: { courier_id: 1 } },
      providerBookingId: "1",
    });
    expect(tracking.latitude).toBeNull();
    expect(tracking.longitude).toBeNull();
  });

  it("maps successful cancellation", () => {
    const result = mapBorzoCancelOrderToCancellationResult(
      successfulBorzoCancelOrderResponse,
      "1250100",
    );
    expect(result.success).toBe(true);
    expect(result.outcome).toBe("CANCELLED");
    expect(result.status).toBe("canceled");
  });

  it("maps rejected cancellation without marking success", () => {
    const result = mapBorzoCancelOrderToCancellationResult(
      rejectedBorzoCancelOrderResponse,
      "1250100",
    );
    expect(result.success).toBe(false);
    expect(result.outcome).toBe("REJECTED");
  });

  it("parses numeric Borzo order ids", () => {
    expect(parseBorzoOrderId("1250100")).toBe(1250100);
    expect(() => parseBorzoOrderId("not-a-number")).toThrow(
      "Invalid Borzo order id.",
    );
  });
});
