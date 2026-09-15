import type { DeliveryStatus } from "@prisma/client";

const TERMINAL_STATUSES = new Set<DeliveryStatus>([
  "DELIVERED",
  "CANCELLED",
  "FAILED",
]);

const ALLOWED_TRANSITIONS: Partial<Record<DeliveryStatus, DeliveryStatus[]>> = {
  CREATED: ["ORCHESTRATING", "CANCELLED"],
  ORCHESTRATING: ["OPTION_READY", "FAILED", "CANCELLED"],
  OPTION_READY: ["BOOKING", "CANCELLED"],
  BOOKING: ["BOOKED", "FAILED"],
  BOOKED: ["DRIVER_ASSIGNED", "PICKUP_OTP_PENDING", "CANCELLED"],
  DRIVER_ASSIGNED: ["PICKUP_OTP_PENDING", "CANCELLED"],
  PICKUP_OTP_PENDING: ["PICKED_UP", "CANCELLED"],
  PICKED_UP: ["IN_TRANSIT"],
  IN_TRANSIT: ["DELIVERY_OTP_PENDING"],
  DELIVERY_OTP_PENDING: ["DELIVERED"],
};

export function isTerminalDeliveryStatus(status: DeliveryStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function canTransitionDelivery(
  from: DeliveryStatus,
  to: DeliveryStatus,
): boolean {
  if (from === to) {
    return true;
  }
  if (isTerminalDeliveryStatus(from)) {
    return false;
  }
  const allowed = ALLOWED_TRANSITIONS[from];
  return allowed?.includes(to) ?? false;
}

const STATUS_RANK: Partial<Record<DeliveryStatus, number>> = {
  CREATED: 0,
  ORCHESTRATING: 1,
  OPTION_READY: 2,
  BOOKING: 3,
  BOOKED: 4,
  DRIVER_ASSIGNED: 5,
  PICKUP_OTP_PENDING: 6,
  PICKED_UP: 7,
  IN_TRANSIT: 8,
  DELIVERY_OTP_PENDING: 9,
  DELIVERED: 10,
  CANCELLED: 11,
  FAILED: 12,
};

export function isStaleOperationalTransition(
  currentStatus: DeliveryStatus,
  targetStatus: DeliveryStatus,
): boolean {
  if (isTerminalDeliveryStatus(currentStatus)) {
    return targetStatus !== currentStatus;
  }
  const currentRank = STATUS_RANK[currentStatus] ?? -1;
  const targetRank = STATUS_RANK[targetStatus] ?? -1;
  return targetRank < currentRank;
}

export const CANCELLABLE_DELIVERY_STATUSES: DeliveryStatus[] = [
  "CREATED",
  "ORCHESTRATING",
  "OPTION_READY",
  "BOOKED",
  "DRIVER_ASSIGNED",
  "PICKUP_OTP_PENDING",
];
