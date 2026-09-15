import type {
  DriverAssignmentStatus,
  OperationalDataSource,
} from "@prisma/client";
import type { PhoneResponse } from "../../core/phone/phone.types.js";
import type { NormalizedDriver } from "../provider/contracts/common.js";

export type DriverAssignmentDto = {
  id: string;
  deliveryId: string;
  providerBookingId: string;
  providerId: string;
  providerDriverId: string | null;
  driverName: string | null;
  driverPhoneCountryCode: string | null;
  driverPhoneNumber: string | null;
  driverPhotoUrl: string | null;
  providerRating: number | null;
  vehicleType: string | null;
  vehicleNumber: string | null;
  assignedAt: Date | null;
  status: DriverAssignmentStatus;
  source: OperationalDataSource;
  providerStatus: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CustomerDriverResponse = {
  known: boolean;
  assigned?: boolean;
  driver?: {
    name: string | null;
    phone: PhoneResponse | null;
    photoUrl: string | null;
    vehicleType: string | null;
    vehicleNumber: string | null;
    assignedAt: string | null;
  } | null;
  status?: DriverAssignmentStatus;
};

export type UpsertDriverInput = {
  deliveryId: string;
  providerBookingId: string;
  providerId: string;
  driver: NormalizedDriver | null;
  known: boolean;
  assigned: boolean;
  source: OperationalDataSource;
  providerStatus?: string | null;
  metadata?: Record<string, unknown>;
};
