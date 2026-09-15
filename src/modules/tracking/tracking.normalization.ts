export type NormalizedTrackingStatus =
  | "BOOKED"
  | "DRIVER_ASSIGNED"
  | "PICKUP_STARTED"
  | "PICKED_UP"
  | "IN_TRANSIT"
  | "NEAR_DESTINATION"
  | "DELIVERY_ATTEMPTED"
  | "DELIVERED"
  | "CANCELLED"
  | "FAILED"
  | "UNKNOWN";

const KEYWORD_MAP: Array<[RegExp, NormalizedTrackingStatus]> = [
  [/delivered|finished|completed/i, "DELIVERED"],
  [/cancel/i, "CANCELLED"],
  [/pick.?up|picked/i, "PICKED_UP"],
  [/in.?transit|transit|on.?the.?way|out.?for.?delivery/i, "IN_TRANSIT"],
  [/driver.?assign|courier.?assign|assigned/i, "DRIVER_ASSIGNED"],
  [/near|arriv/i, "NEAR_DESTINATION"],
  [/fail|reject/i, "FAILED"],
];

export function normalizeProviderTrackingStatus(
  rawStatus: string | null | undefined,
): NormalizedTrackingStatus {
  if (!rawStatus) {
    return "UNKNOWN";
  }
  for (const [pattern, normalized] of KEYWORD_MAP) {
    if (pattern.test(rawStatus)) {
      return normalized;
    }
  }
  return "UNKNOWN";
}

export function validateCoordinates(input: {
  latitude: number | null;
  longitude: number | null;
}): boolean {
  if (input.latitude == null && input.longitude == null) {
    return true;
  }
  if (input.latitude == null || input.longitude == null) {
    return false;
  }
  return (
    input.latitude >= -90 &&
    input.latitude <= 90 &&
    input.longitude >= -180 &&
    input.longitude <= 180
  );
}
