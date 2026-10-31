import type { BookingRequest } from "../../contracts/booking.js";
import {
  parseShiprocketOrderShowDetails,
  toCreatedOrderSnapshot,
} from "./shiprocket-order-show.parse.js";

/**
 * Shiprocket identifier semantics (do not conflate):
 * - **Channel order id** — Doot `deliveryReference` (sanitized) sent as adhoc `order_id` and stored in
 *   `metadata.shiprocketChannelOrderId`. Used for orders/show during create idempotency (channel path only).
 * - **Shiprocket order id** — numeric `data.id` from create/show; stored as `providerBookingId` when known
 *   and duplicated in `metadata.shiprocketOrderId`.
 * - **Shipment id** — `data.shipments[].id`; stored as `providerReference` and `metadata.shiprocketShipmentId`.
 * - **AWB** — courier assignment code; stored in `metadata.shiprocketAwbCode` when validated.
 */

export function buildShiprocketExternalOrderId(request: {
  deliveryReference?: string;
  idempotencyKey?: string;
}): string {
  const raw = request.deliveryReference ?? request.idempotencyKey ?? "doot-order";
  return raw.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 50);
}

export type ShiprocketCreatedOrderSnapshot = {
  orderId: string;
  shipmentId: string;
  status: string;
  awbCode: string | null;
};

export function parseShiprocketOrderShowBody(
  body: unknown,
): ShiprocketCreatedOrderSnapshot | null {
  const details = parseShiprocketOrderShowDetails(body);
  if (!details) {
    return null;
  }
  return toCreatedOrderSnapshot(details);
}

export function bookingRequestChannelOrderId(request: BookingRequest): string {
  return buildShiprocketExternalOrderId(request);
}
