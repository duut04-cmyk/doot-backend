import { DELIVERY_REFERENCE_PREFIX } from "../delivery/delivery.constants.js";

export const CANCELLATION_REASON_CODES = [
  "CUSTOMER_CHANGED_MIND",
  "WRONG_ADDRESS",
  "WRONG_PACKAGE_DETAILS",
  "DELIVERY_NO_LONGER_REQUIRED",
  "PROVIDER_DELAY",
  "OTHER",
] as const;

export type CancellationReasonCode =
  (typeof CANCELLATION_REASON_CODES)[number];

export function buildCancellationCorrelationReference(
  deliveryReference: string,
  attemptNumber: number,
): string {
  return `${DELIVERY_REFERENCE_PREFIX}-${deliveryReference}-CANCEL-${attemptNumber}`;
}
