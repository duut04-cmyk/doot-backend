import { describe, expect, it } from "vitest";
import {
  mapBorzoCalculateOrderToProbeResult,
  mapQuoteRequestToBorzoCalculateOrder,
  toBorzoPhone,
} from "../src/modules/provider/adapters/borzo/borzo.mapper.js";
import {
  failedBorzoCalculateOrderResponse,
  sampleQuoteRequest,
  successfulBorzoCalculateOrderResponse,
  warningBorzoCalculateOrderResponse,
} from "./helpers/borzo-test-fixtures.js";

describe("Borzo mapper", () => {
  it("maps Dutt quote request to Borzo calculate-order body", () => {
    const body = mapQuoteRequestToBorzoCalculateOrder(sampleQuoteRequest);
    expect(body.type).toBe("standard");
    expect(body.matter).toBe("Documents");
    expect(body.total_weight_kg).toBe(2);
    expect(body.vehicle_type_id).toBe(8);
    expect(body.points).toHaveLength(2);
    expect(body.points[0]?.address).toBe("12 MG Road, Bengaluru");
    expect(body.points[0]?.contact_person?.phone).toBe("919876543210");
    expect(body.points[0]?.contact_person?.name).toBe("Riya");
    expect(body.points[0]?.note).toBe("Gate 2");
    expect(body.points[1]?.contact_person?.phone).toBe("919811122233");
  });

  it("normalizes E.164 phone numbers for Borzo", () => {
    expect(toBorzoPhone("+919876543210")).toBe("919876543210");
  });

  it("maps successful calculate-order response to normalized quote", () => {
    const result = mapBorzoCalculateOrderToProbeResult(
      successfulBorzoCalculateOrderResponse,
      sampleQuoteRequest,
    );
    expect(result.quote.available).toBe(true);
    expect(result.quote.amount).toEqual({ amount: 170, currency: "INR" });
    expect(result.quote.breakdown?.baseAmount).toBe(170);
    expect(result.quote.breakdown?.totalAmount).toBe(170);
    expect(result.quote.providerQuoteId).toBe("1250032");
    expect(result.quote.estimatedDeliveryAt).toBeTruthy();
    expect(result.serviceability.serviceable).toBe(true);
    expect(result.availability.known).toBe(false);
    expect(result.availability.available).toBe(false);
    expect(result.availability.availableDriverCount).toBeNull();
    expect(result.availability.drivers).toBeNull();
    expect(result.providerMetadata.borzoVehicleTypeId).toBe(8);
  });

  it("treats warnings as not serviceable", () => {
    const result = mapBorzoCalculateOrderToProbeResult(
      warningBorzoCalculateOrderResponse,
      sampleQuoteRequest,
    );
    expect(result.serviceability.serviceable).toBe(false);
    expect(result.quote.available).toBe(false);
    expect(result.warnings).toContain("invalid_parameters");
  });

  it("maps failed provider response safely", () => {
    const result = mapBorzoCalculateOrderToProbeResult(
      failedBorzoCalculateOrderResponse,
      sampleQuoteRequest,
    );
    expect(result.quote.available).toBe(false);
    expect(result.quote.amount).toBeNull();
    expect(result.serviceability.serviceable).toBe(false);
    expect(result.quote.estimatedDeliveryAt).toBeNull();
  });

  it("does not fabricate driver availability", () => {
    const result = mapBorzoCalculateOrderToProbeResult(
      successfulBorzoCalculateOrderResponse,
      sampleQuoteRequest,
    );
    expect(result.availability.known).toBe(false);
    expect(result.availability.reason).toContain("not provided");
  });

  it("never conflates unknown availability with known unavailability", () => {
    const result = mapBorzoCalculateOrderToProbeResult(
      successfulBorzoCalculateOrderResponse,
      sampleQuoteRequest,
    );
    expect(result.availability.known).toBe(false);
    expect(result.availability.availableDriverCount).toBeNull();
    expect(result.availability.drivers).toBeNull();
  });
});
