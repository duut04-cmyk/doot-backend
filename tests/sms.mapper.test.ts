import { describe, expect, it } from "vitest";
import { buildOtpSmsTemplateVariables } from "../src/infrastructure/sms/sms.mapper.js";
import type { DriverAssignmentDto } from "../src/modules/driver/driver.types.js";

function assignment(overrides: Partial<DriverAssignmentDto> = {}): DriverAssignmentDto {
  const now = new Date();
  return {
    id: "driver-assignment-id",
    deliveryId: "delivery-id",
    providerBookingId: "booking-id",
    providerId: "provider-id",
    providerDriverId: "provider-driver-id",
    driverName: "Aman Singh",
    driverPhoneCountryCode: "+91",
    driverPhoneNumber: "9876543210",
    driverPhotoUrl: null,
    providerRating: 4.8,
    vehicleType: "BIKE",
    vehicleNumber: "PB10AB1234",
    assignedAt: now,
    status: "ASSIGNED",
    source: "WEBHOOK",
    providerStatus: "assigned",
    metadata: { secret: "should-not-leak" },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("buildOtpSmsTemplateVariables", () => {
  it("builds pickup template variables with driver details", () => {
    const result = buildOtpSmsTemplateVariables({
      eventType: "PICKUP",
      otp: "123456",
      deliveryReference: "DOTT-2001",
      driverAssignment: assignment(),
    });

    expect(result).toEqual({
      otp: "123456",
      delivery_reference: "DOTT-2001",
      driver_name: "Aman Singh",
      vehicle_type: "BIKE",
      vehicle_number: "PB10AB1234",
      driver_phone_masked: "****3210",
      event_type: "PICKUP",
    });
  });

  it("uses safe fallbacks when driver is not assigned", () => {
    const result = buildOtpSmsTemplateVariables({
      eventType: "DELIVERY",
      otp: "654321",
      deliveryReference: "DOTT-2002",
      driverAssignment: assignment({ status: "UNKNOWN", driverName: null }),
    });

    expect(result.driver_name).toBe("Not assigned");
    expect(result.vehicle_type).toBe("Not available");
    expect(result.vehicle_number).toBe("Not available");
    expect(result.driver_phone_masked).toBe("Not available");
    expect(result.event_type).toBe("DELIVERY");
  });

  it("handles missing driver assignment", () => {
    const result = buildOtpSmsTemplateVariables({
      eventType: "PICKUP",
      otp: "111111",
      deliveryReference: "DOTT-2003",
      driverAssignment: null,
    });

    expect(result.driver_name).toBe("Not assigned");
    expect(result).not.toHaveProperty("providerId");
  });
});
