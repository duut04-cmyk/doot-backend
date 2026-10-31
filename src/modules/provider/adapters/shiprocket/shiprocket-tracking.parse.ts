import { createHash } from "node:crypto";
import { shiprocketTrackingResponseSchema } from "./shiprocket.types.js";

export type ShiprocketTrackingAvailability = "AVAILABLE" | "PENDING" | "UNKNOWN";

export type ShiprocketTrackingActivity = {
  date: string | null;
  status: string | null;
  activity: string | null;
  location: string | null;
  providerStatusCode: string | null;
  providerStatusLabel: string | null;
};

export type ParsedShiprocketTracking = {
  availability: ShiprocketTrackingAvailability;
  rawStatus: string;
  trackStatus: number | null;
  trackingUrl: string | null;
  estimatedDelivery: string | null;
  pickupDate: string | null;
  deliveredDate: string | null;
  awbCode: string | null;
  shipmentId: string | null;
  orderId: string | null;
  courierName: string | null;
  courierId: string | null;
  activities: ShiprocketTrackingActivity[];
  providerEventId: string | null;
  pendingReason: string | null;
};

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readTrackStatus(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return null;
}

function trackingDataRoot(body: Record<string, unknown>): Record<string, unknown> {
  const nested = body.tracking_data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return { ...body, ...(nested as Record<string, unknown>) };
  }
  return body;
}

function mapActivity(raw: Record<string, unknown>): ShiprocketTrackingActivity {
  return {
    date: readString(raw.date),
    status: readString(raw.status),
    activity: readString(raw.activity),
    location: readString(raw.location),
    providerStatusCode: readString(raw["sr-status"]),
    providerStatusLabel: readString(raw["sr-status-label"]),
  };
}

function buildProviderEventId(activities: ShiprocketTrackingActivity[]): string | null {
  const latest = activities[0];
  if (!latest) {
    return null;
  }
  const fingerprint = [
    latest.date ?? "",
    latest.status ?? "",
    latest.activity ?? "",
    latest.location ?? "",
  ].join("|");
  if (fingerprint === "|||") {
    return null;
  }
  return createHash("sha256").update(fingerprint).digest("hex").slice(0, 32);
}

export function isValidHttpUrl(value: string | null | undefined): value is string {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function toIsoDateTimeOrNull(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

export function parseShiprocketTrackingResponse(
  body: unknown,
): ParsedShiprocketTracking {
  const parsed = shiprocketTrackingResponseSchema.safeParse(body);
  if (!parsed.success) {
    return {
      availability: "UNKNOWN",
      rawStatus: "UNKNOWN",
      trackStatus: null,
      trackingUrl: null,
      estimatedDelivery: null,
      pickupDate: null,
      deliveredDate: null,
      awbCode: null,
      shipmentId: null,
      orderId: null,
      courierName: null,
      courierId: null,
      activities: [],
      providerEventId: null,
      pendingReason: null,
    };
  }

  const row = trackingDataRoot(parsed.data as Record<string, unknown>);

  const trackStatus = readTrackStatus(row.track_status);
  const pendingError = readString(row.error);
  const activitiesRaw = Array.isArray(row.shipment_track_activities)
    ? row.shipment_track_activities
    : [];
  const activities = activitiesRaw
    .filter(
      (entry): entry is Record<string, unknown> => !!entry && typeof entry === "object",
    )
    .map(mapActivity);

  const shipmentTrack = Array.isArray(row.shipment_track) ? row.shipment_track : [];
  const firstTrack =
    shipmentTrack[0] && typeof shipmentTrack[0] === "object"
      ? (shipmentTrack[0] as Record<string, unknown>)
      : null;

  const rawStatus =
    readString(row.shipment_status) ??
    readString(firstTrack?.current_status) ??
    readString(firstTrack?.status) ??
    (trackStatus === 0 ? "TRACKING_PENDING" : "UNKNOWN");

  let availability: ShiprocketTrackingAvailability = "UNKNOWN";
  if (trackStatus === 0 || pendingError) {
    availability = "PENDING";
  } else if (
    readString(row.shipment_status) ||
    readString(firstTrack?.current_status) ||
    activities.length > 0
  ) {
    availability = "AVAILABLE";
  }

  const awbCode =
    readString(firstTrack?.awb_code) ??
    readString(row.awb_code) ??
    readString(firstTrack?.awb);

  const courierIdRaw = firstTrack?.courier_company_id ?? firstTrack?.courier_id;
  const courierId =
    courierIdRaw != null && String(courierIdRaw).length > 0
      ? String(courierIdRaw)
      : null;

  const trackUrlRaw = readString(row.track_url) ?? readString(firstTrack?.track_url);
  const trackingUrl = isValidHttpUrl(trackUrlRaw) ? trackUrlRaw : null;

  return {
    availability,
    rawStatus,
    trackStatus,
    trackingUrl,
    estimatedDelivery: readString(row.etd) ?? readString(firstTrack?.edd),
    pickupDate: readString(firstTrack?.pickup_date),
    deliveredDate: readString(firstTrack?.delivered_date),
    awbCode,
    shipmentId:
      firstTrack?.shipment_id != null
        ? String(firstTrack.shipment_id as string | number)
        : null,
    orderId:
      firstTrack?.order_id != null
        ? String(firstTrack.order_id as string | number)
        : null,
    courierName: readString(firstTrack?.courier_name),
    courierId,
    activities,
    providerEventId: buildProviderEventId(activities),
    pendingReason: pendingError,
  };
}
