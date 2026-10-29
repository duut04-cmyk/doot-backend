import {
  isValidShiprocketAwbCode,
  isValidShiprocketShipmentId,
  type ShiprocketOrderShowDetails,
} from "./shiprocket-order-show.parse.js";

export type ShiprocketCancelReconcileOutcome =
  "CONFIRMED_CANCELLED" | "STILL_ACTIVE" | "INCONCLUSIVE";

function normalizeStatusToken(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, " ");
}

function combinedStatusText(details: ShiprocketOrderShowDetails): string {
  return [
    normalizeStatusToken(details.status),
    normalizeStatusToken(details.subStatus),
    normalizeStatusToken(details.shipmentStatus),
  ]
    .filter((part) => part.length > 0)
    .join(" ");
}

const CANCELLED_TOKENS = ["CANCELLED", "CANCELED", "ORDER CANCELLED", "ORDER CANCELED"];

const NON_CANCELLABLE_ACTIVE_TOKENS = [
  "DELIVERED",
  "RTO DELIVERED",
  "IN TRANSIT",
  "OUT FOR DELIVERY",
  "OUT FOR PICKUP",
  "PICKED UP",
  "SHIPPED",
  "REACHED AT DESTINATION",
  "MISROUTED",
  "LOST",
  "DAMAGED",
];

/** Active pre-shipment states — treated as still active after a cancel POST if unchanged. */
const PRE_SHIPMENT_ACTIVE_TOKENS = [
  "NEW",
  "PROCESSING",
  "READY TO SHIP",
  "PICKUP SCHEDULED",
];

function matchesAnyToken(haystack: string, tokens: string[]): boolean {
  return tokens.some((token) => haystack === token || haystack.includes(token));
}

/** Conservative post-cancel interpretation of orders/show fields. */
export function reconcileShiprocketCancelFromOrderShow(
  details: ShiprocketOrderShowDetails,
): ShiprocketCancelReconcileOutcome {
  const text = combinedStatusText(details);
  if (text.length === 0) {
    return "INCONCLUSIVE";
  }

  if (matchesAnyToken(text, CANCELLED_TOKENS)) {
    return "CONFIRMED_CANCELLED";
  }

  if (matchesAnyToken(text, NON_CANCELLABLE_ACTIVE_TOKENS)) {
    return "STILL_ACTIVE";
  }

  if (matchesAnyToken(text, PRE_SHIPMENT_ACTIVE_TOKENS)) {
    return "STILL_ACTIVE";
  }

  return "INCONCLUSIVE";
}

/** Block provider cancel when shipment is in motion or terminal at Shiprocket (not pre-ship NEW). */
export function isShiprocketOrderNonCancellableAtProvider(
  details: ShiprocketOrderShowDetails,
): boolean {
  const text = combinedStatusText(details);
  if (text.length === 0) {
    return false;
  }
  if (matchesAnyToken(text, CANCELLED_TOKENS)) {
    return false;
  }
  return matchesAnyToken(text, NON_CANCELLABLE_ACTIVE_TOKENS);
}

export function isShiprocketOrderAlreadyCancelledAtProvider(
  details: ShiprocketOrderShowDetails,
): boolean {
  return reconcileShiprocketCancelFromOrderShow(details) === "CONFIRMED_CANCELLED";
}

/**
 * Pre-cancel guard: AWB or shipment id without interpretable status — do not POST cancel.
 */
export function isShiprocketCancelPreflightIndeterminate(
  details: ShiprocketOrderShowDetails,
): boolean {
  const hasAssignment =
    isValidShiprocketAwbCode(details.awbCode) ||
    isValidShiprocketShipmentId(details.shipmentId);
  if (!hasAssignment) {
    return false;
  }
  const text = combinedStatusText(details);
  if (text.length === 0) {
    return true;
  }
  return normalizeStatusToken(details.status) === "UNKNOWN";
}
