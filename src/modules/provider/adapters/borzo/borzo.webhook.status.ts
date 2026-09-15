export type BorzoNormalizedLifecycleStatus =
  | "UNKNOWN"
  | "CANCELLED"
  | "DELIVERED";

/**
 * Maps Borzo order statuses to a safe normalized hint for metadata only.
 * Phase 4B does not update Dutt Delivery status from webhooks.
 */
export function normalizeBorzoOrderStatus(
  rawStatus: string | null | undefined,
): BorzoNormalizedLifecycleStatus {
  if (!rawStatus) {
    return "UNKNOWN";
  }
  if (rawStatus === "canceled") {
    return "CANCELLED";
  }
  return "UNKNOWN";
}

/**
 * Maps Borzo delivery statuses to a safe normalized hint for metadata only.
 */
export function normalizeBorzoDeliveryStatus(
  rawStatus: string | null | undefined,
): BorzoNormalizedLifecycleStatus {
  if (!rawStatus) {
    return "UNKNOWN";
  }
  if (rawStatus === "canceled") {
    return "CANCELLED";
  }
  if (rawStatus === "finished") {
    return "DELIVERED";
  }
  return "UNKNOWN";
}
