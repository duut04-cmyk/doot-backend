import type { BookingRequest } from "../../contracts/booking.js";
import { shiprocketOrderShowResponseSchema } from "./shiprocket.types.js";

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
  const parsed = shiprocketOrderShowResponseSchema.safeParse(body);
  if (!parsed.success || !parsed.data.data) {
    return null;
  }
  const row = parsed.data.data as Record<string, unknown>;
  const orderIdRaw = row.id ?? row.order_id;
  if (orderIdRaw == null) {
    return null;
  }
  const shipments = Array.isArray(row.shipments) ? row.shipments : [];
  const firstShipment = shipments[0] as Record<string, unknown> | undefined;
  const shipmentId =
    firstShipment?.id != null ? String(firstShipment.id as string | number) : null;
  if (!shipmentId) {
    return null;
  }
  const awb = typeof row.awb_code === "string" ? row.awb_code : null;
  const status =
    typeof row.status === "string" && row.status.length > 0 ? row.status : "NEW";

  return {
    orderId: String(orderIdRaw),
    shipmentId,
    status,
    awbCode: awb,
  };
}

export function bookingRequestChannelOrderId(request: BookingRequest): string {
  return buildShiprocketExternalOrderId(request);
}
