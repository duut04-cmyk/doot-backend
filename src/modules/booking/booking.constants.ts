/** Default quote max age when env is unset (seconds). */
export const DEFAULT_BOOKING_QUOTE_MAX_AGE_SECONDS = 300;

/** Default price tolerance for silent re-quote acceptance (percent). */
export const DEFAULT_BOOKING_PRICE_TOLERANCE_PERCENT = 0;

export const CONFIRM_REQUEST_HASH = "confirm:v1:{}";

export function buildBookingCorrelationReference(
  deliveryReference: string,
  attemptNumber: number,
): string {
  return `${deliveryReference}-BOOKING-${attemptNumber}`;
}
