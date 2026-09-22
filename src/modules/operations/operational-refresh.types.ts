import type { DeliveryStatus } from "@prisma/client";
import type { DriverAssignmentDto } from "../driver/driver.types.js";
import type { TrackingPointDto } from "../tracking/tracking.repository.js";

export type OperationalRefreshSource =
  "PROVIDER_POLL" | "ADMIN_DRIVER_REFRESH" | "ADMIN_TRACKING_REFRESH";

export type OperationalRefreshFailureMode = "preserve" | "throw";

export type OperationalRefreshResult = {
  pollSucceeded: boolean;
  deliveryId: string;
  deliveryStatus: DeliveryStatus;
  driverAssignment: DriverAssignmentDto | null;
  trackingPoint: TrackingPointDto | null;
};
