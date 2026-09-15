import type { UserRole } from "@prisma/client";
import type { CustomerDriverResponse, DriverAssignmentDto } from "./driver.types.js";

export function toCustomerDriverResponse(
  assignment: DriverAssignmentDto | null,
): CustomerDriverResponse {
  if (!assignment) {
    return { known: false };
  }

  if (assignment.status === "UNKNOWN") {
    return { known: false };
  }

  if (assignment.status !== "ASSIGNED") {
    return {
      known: true,
      assigned: false,
      status: assignment.status,
      driver: null,
    };
  }

  return {
    known: true,
    assigned: true,
    status: assignment.status,
    driver: {
      name: assignment.driverName,
      phone: assignment.driverPhone,
      photoUrl: assignment.driverPhotoUrl,
      vehicleType: assignment.vehicleType,
      vehicleNumber: assignment.vehicleNumber,
      assignedAt: assignment.assignedAt?.toISOString() ?? null,
    },
  };
}

export function toAdminDriverResponse(
  role: UserRole,
  assignment: DriverAssignmentDto | null,
) {
  const customer = toCustomerDriverResponse(assignment);
  if (role !== "ADMIN" || !assignment) {
    return customer;
  }
  return {
    ...customer,
    assignment: {
      id: assignment.id,
      providerBookingId: assignment.providerBookingId,
      providerId: assignment.providerId,
      providerDriverId: assignment.providerDriverId,
      providerRating: assignment.providerRating,
      source: assignment.source,
      providerStatus: assignment.providerStatus,
      createdAt: assignment.createdAt.toISOString(),
      updatedAt: assignment.updatedAt.toISOString(),
    },
  };
}
