import type { ShiprocketCreatedOrderSnapshot } from "./shiprocket-order.util.js";
import { shiprocketOrderShowResponseSchema } from "./shiprocket.types.js";

export type ShiprocketOrderShowDetails = {
  orderId: string;
  channelOrderId: string | null;
  status: string;
  statusCode: string | null;
  subStatus: string | null;
  shipmentId: string | null;
  awbCode: string | null;
  courierName: string | null;
  courierId: string | null;
  shipmentStatus: string | null;
  estimatedDelivery: string | null;
  deliveredDate: string | null;
};

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readStatusCode(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return readString(value);
}

function awbFromObject(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  return readString(row.awb) ?? readString(row.awb_code) ?? readString(row.awbCode);
}

/** Best-effort AWB from orders/show `data` (never treat shipment id as AWB). */
export function extractShiprocketOrderShowAwb(
  row: Record<string, unknown>,
): string | null {
  const topLevel = readString(row.awb_code) ?? readString(row.awb);
  if (topLevel) {
    return topLevel;
  }

  const awbData = row.awb_data;
  if (Array.isArray(awbData)) {
    for (const entry of awbData) {
      const fromEntry = awbFromObject(entry);
      if (fromEntry) {
        return fromEntry;
      }
    }
  } else {
    const fromAwbData = awbFromObject(awbData);
    if (fromAwbData) {
      return fromAwbData;
    }
  }

  for (const entry of normalizeShipmentEntries(row.shipments)) {
    const fromShipment = awbFromObject(entry);
    if (fromShipment) {
      return fromShipment;
    }
  }

  return null;
}

/** Shiprocket may return `shipments` as an array or a single object (fixture-backed). */
export function normalizeShipmentEntries(
  shipments: unknown,
): Record<string, unknown>[] {
  if (Array.isArray(shipments)) {
    return shipments.filter(
      (entry): entry is Record<string, unknown> =>
        entry != null && typeof entry === "object" && !Array.isArray(entry),
    );
  }
  if (shipments != null && typeof shipments === "object" && !Array.isArray(shipments)) {
    return [shipments as Record<string, unknown>];
  }
  return [];
}

function firstShipment(row: Record<string, unknown>): Record<string, unknown> | null {
  return normalizeShipmentEntries(row.shipments)[0] ?? null;
}

function rawOrderShowDataRow(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const data = (body as Record<string, unknown>).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  return data as Record<string, unknown>;
}

export function parseShiprocketOrderShowDetails(
  body: unknown,
): ShiprocketOrderShowDetails | null {
  shiprocketOrderShowResponseSchema.safeParse(body);
  const row = rawOrderShowDataRow(body);
  if (!row) {
    return null;
  }
  const orderIdRaw = row.id ?? row.order_id;
  if (orderIdRaw == null) {
    return null;
  }

  const shipment = firstShipment(row);
  const shipmentId =
    shipment?.id != null ? String(shipment.id as string | number) : null;

  const awbCode = extractShiprocketOrderShowAwb(row);

  const courierRaw = shipment?.courier ?? shipment?.courier_name;
  const courierName = readString(courierRaw);
  const courierIdRaw = shipment?.courier_id ?? shipment?.courier_company_id;
  const courierId =
    courierIdRaw != null && String(courierIdRaw).length > 0
      ? String(courierIdRaw)
      : null;

  const status =
    readString(row.status) ??
    readString(shipment?.status) ??
    (awbCode || shipmentId ? "NEW" : "UNKNOWN");

  return {
    orderId: String(orderIdRaw),
    channelOrderId: readString(row.channel_order_id),
    status,
    statusCode: readStatusCode(row.status_code),
    subStatus: readString(row.sub_status),
    shipmentId,
    awbCode,
    courierName,
    courierId,
    shipmentStatus: readString(shipment?.status),
    estimatedDelivery: readString(shipment?.etd),
    deliveredDate: readString(shipment?.delivered_date),
  };
}

export function toCreatedOrderSnapshot(
  details: ShiprocketOrderShowDetails,
): ShiprocketCreatedOrderSnapshot | null {
  if (!details.shipmentId) {
    return null;
  }
  return {
    orderId: details.orderId,
    shipmentId: details.shipmentId,
    status: details.status,
    awbCode: isValidShiprocketAwbCode(details.awbCode) ? details.awbCode.trim() : null,
  };
}

const AWB_PATTERN = /^[A-Za-z0-9-]{6,32}$/;

export function confirmedShiprocketAwbCode(
  awb: string | null | undefined,
): string | null {
  return isValidShiprocketAwbCode(awb) ? awb.trim() : null;
}

export function isValidShiprocketShipmentId(
  shipmentId: string | null | undefined,
): shipmentId is string {
  if (!shipmentId) {
    return false;
  }
  const trimmed = shipmentId.trim();
  return /^\d+$/.test(trimmed) && trimmed.length > 0;
}

/** Numeric Shiprocket order id (`data.id`) — not channel order id, shipment id, or AWB. */
export function isValidShiprocketOrderId(
  orderId: string | null | undefined,
): orderId is string {
  return isValidShiprocketShipmentId(orderId);
}

export function isValidShiprocketAwbCode(
  awb: string | null | undefined,
): awb is string {
  if (!awb) {
    return false;
  }
  const trimmed = awb.trim();
  return trimmed.length > 0 && AWB_PATTERN.test(trimmed);
}
