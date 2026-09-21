import type { DriverAssignmentDto } from "../../modules/driver/driver.types.js";
import type { OtpSmsTemplateVariables } from "./sms.types.js";

const NOT_ASSIGNED = "Not assigned";
const NOT_AVAILABLE = "Not available";

export function maskPhoneForSms(
  countryCode: string | null | undefined,
  number: string | null | undefined,
): string {
  if (!countryCode || !number) {
    return NOT_AVAILABLE;
  }

  const digits = number.replace(/\D/g, "");
  if (digits.length < 4) {
    return "****";
  }

  return `****${digits.slice(-4)}`;
}

function resolveDriverName(assignment: DriverAssignmentDto | null): string {
  if (!assignment || assignment.status !== "ASSIGNED") {
    return NOT_ASSIGNED;
  }

  const name = assignment.driverName?.trim();
  return name || NOT_ASSIGNED;
}

function resolveVehicleType(assignment: DriverAssignmentDto | null): string {
  if (!assignment || assignment.status !== "ASSIGNED") {
    return NOT_AVAILABLE;
  }

  return assignment.vehicleType?.trim() || NOT_AVAILABLE;
}

function resolveVehicleNumber(assignment: DriverAssignmentDto | null): string {
  if (!assignment || assignment.status !== "ASSIGNED") {
    return NOT_AVAILABLE;
  }

  return assignment.vehicleNumber?.trim() || NOT_AVAILABLE;
}

function resolveDriverPhoneMasked(assignment: DriverAssignmentDto | null): string {
  if (!assignment || assignment.status !== "ASSIGNED") {
    return NOT_AVAILABLE;
  }

  return maskPhoneForSms(
    assignment.driverPhoneCountryCode,
    assignment.driverPhoneNumber,
  );
}

export function buildOtpSmsTemplateVariables(input: {
  eventType: "PICKUP" | "DELIVERY";
  otp: string;
  deliveryReference: string;
  driverAssignment: DriverAssignmentDto | null;
}): OtpSmsTemplateVariables {
  return {
    otp: input.otp,
    delivery_reference: input.deliveryReference,
    driver_name: resolveDriverName(input.driverAssignment),
    vehicle_type: resolveVehicleType(input.driverAssignment),
    vehicle_number: resolveVehicleNumber(input.driverAssignment),
    driver_phone_masked: resolveDriverPhoneMasked(input.driverAssignment),
    event_type: input.eventType,
  };
}
