import type { DeliveryStatus } from "@prisma/client";

/** Deliveries created in period that are currently in this terminal success state. */
export const DELIVERED_DELIVERY_STATUS: DeliveryStatus = "DELIVERED";

export const IN_PROGRESS_DELIVERY_STATUSES: DeliveryStatus[] = [
  "CREATED",
  "ORCHESTRATING",
  "OPTION_READY",
  "BOOKING",
  "BOOKED",
  "DRIVER_ASSIGNED",
  "PICKUP_OTP_PENDING",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERY_OTP_PENDING",
];

export const TERMINAL_NON_SUCCESS_DELIVERY_STATUSES: DeliveryStatus[] = [
  "CANCELLED",
  "FAILED",
];

export const MAX_REPORTING_RANGE_DAYS = 366;
export const MAX_RECENT_DELIVERIES_LIMIT = 50;
export const DEFAULT_RECENT_DELIVERIES_LIMIT = 10;
export const MAX_RECENT_ACTIVITY_LIMIT = 100;
export const DEFAULT_RECENT_ACTIVITY_LIMIT = 20;
export const MAX_RECENT_ACTIVITY_HOURS = 168;
export const DEFAULT_RECENT_ACTIVITY_HOURS = 24;
export const MAX_FEEDBACK_RECENT_LIMIT = 20;
export const DEFAULT_FEEDBACK_RECENT_LIMIT = 5;
