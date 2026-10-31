import { createHash } from "node:crypto";
import { confirmedShiprocketAwbCode } from "./shiprocket-order-show.parse.js";

export const SHIPROCKET_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

const MAX_STRING_LEN = 512;
const MAX_SCANS = 200;

export type ShiprocketWebhookNormalizedScan = {
  providerEventId: string;
  status: string;
  eventTimestamp: string;
  metadata: Record<string, unknown>;
  /** When true, persist tracking history but skip forward delivery lifecycle transitions. */
  skipForwardDeliveryLifecycle: boolean;
};

export type ShiprocketWebhookNormalizeResult =
  | {
      action: "events";
      eventType: string;
      providerOrderId: string | null;
      providerAwb: string | null;
      srOrderId: string | null;
      orderId: string | null;
      isReturn: boolean;
      scans: ShiprocketWebhookNormalizedScan[];
    }
  | {
      action: "ignore";
      reason: string;
      providerOrderId: string | null;
      providerAwb: string | null;
      srOrderId: string | null;
      orderId: string | null;
    }
  | { action: "reject"; reason: string };

function readString(value: unknown, maxLen = MAX_STRING_LEN): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLen) {
    return null;
  }
  return trimmed;
}

function readIdString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return readString(value, 64);
}

function parseShiprocketTimestamp(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const withZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalized)
    ? `${normalized}Z`
    : normalized;
  const date = new Date(withZone);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function isPendingOrEmptyStatus(status: string | null): boolean {
  if (!status) {
    return true;
  }
  const upper = status.toUpperCase();
  return (
    upper === "PENDING" ||
    upper === "NA" ||
    upper === "N/A" ||
    upper === "UNKNOWN" ||
    upper === "TRACKING_PENDING"
  );
}

function buildScanProviderEventId(input: {
  awb: string | null;
  srOrderId: string | null;
  orderId: string | null;
  scan: Record<string, unknown>;
  fallbackStatus: string | null;
  fallbackStatusId: string | null;
  fallbackTimestamp: string | null;
}): string | null {
  const scanDate =
    readString(input.scan.date) ??
    readString(input.scan.current_timestamp) ??
    input.fallbackTimestamp;
  const scanStatus =
    readString(input.scan.status) ??
    readString(input.scan.current_status) ??
    readString(input.scan.shipment_status) ??
    input.fallbackStatus;
  const scanStatusId =
    readIdString(input.scan.status_id) ??
    readIdString(input.scan.current_status_id) ??
    readIdString(input.scan.shipment_status_id) ??
    input.fallbackStatusId;
  const activity = readString(input.scan.activity);
  const location = readString(input.scan.location);

  if (!scanStatus || isPendingOrEmptyStatus(scanStatus)) {
    return null;
  }
  if (!scanDate) {
    return null;
  }

  const fingerprint = [
    input.awb ?? "",
    input.srOrderId ?? "",
    input.orderId ?? "",
    scanDate,
    scanStatus,
    scanStatusId ?? "",
    activity ?? "",
    location ?? "",
  ].join("|");

  return createHash("sha256").update(fingerprint).digest("hex").slice(0, 32);
}

function scanToNormalized(input: {
  awb: string | null;
  srOrderId: string | null;
  orderId: string | null;
  isReturn: boolean;
  topStatus: string | null;
  topStatusId: string | null;
  topTimestamp: string | null;
  scan: Record<string, unknown>;
}): ShiprocketWebhookNormalizedScan | null {
  const status =
    readString(input.scan.status) ??
    readString(input.scan.current_status) ??
    readString(input.scan.shipment_status) ??
    input.topStatus;
  if (!status || isPendingOrEmptyStatus(status)) {
    return null;
  }

  const rawTimestamp =
    readString(input.scan.date) ??
    readString(input.scan.current_timestamp) ??
    input.topTimestamp;
  const eventTimestamp = parseShiprocketTimestamp(rawTimestamp);
  if (!eventTimestamp) {
    return null;
  }

  const providerEventId = buildScanProviderEventId({
    awb: input.awb,
    srOrderId: input.srOrderId,
    orderId: input.orderId,
    scan: input.scan,
    fallbackStatus: input.topStatus,
    fallbackStatusId: input.topStatusId,
    fallbackTimestamp: rawTimestamp,
  });
  if (!providerEventId) {
    return null;
  }

  const statusId =
    readIdString(input.scan.status_id) ??
    readIdString(input.scan.current_status_id) ??
    readIdString(input.scan.shipment_status_id) ??
    input.topStatusId;

  return {
    providerEventId,
    status,
    eventTimestamp,
    skipForwardDeliveryLifecycle: input.isReturn,
    metadata: {
      shiprocketIsReturn: input.isReturn,
      shiprocketCurrentStatusId: statusId,
      shiprocketAwb: input.awb,
      shiprocketSrOrderId: input.srOrderId,
      shiprocketOrderId: input.orderId,
      trackingAvailability: "AVAILABLE",
    },
  };
}

export function normalizeShiprocketTrackingWebhook(
  payload: unknown,
): ShiprocketWebhookNormalizeResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { action: "reject", reason: "payload_not_object" };
  }

  const root = payload as Record<string, unknown>;

  const awbRaw = readString(root.awb, 64);
  const awb = awbRaw ? confirmedShiprocketAwbCode(awbRaw) : null;

  const srOrderId = readIdString(root.sr_order_id);
  const orderId = readIdString(root.order_id);

  if (!awb && !srOrderId && !orderId) {
    return { action: "reject", reason: "missing_identifiers" };
  }

  const isReturn = root.is_return === true || root.is_return === "true";

  const topStatus = readString(root.current_status) ?? readString(root.shipment_status);
  const topStatusId =
    readIdString(root.current_status_id) ?? readIdString(root.shipment_status_id);
  const topTimestamp = readString(root.current_timestamp, 64);

  const scansRaw = root.scans;
  const scans: ShiprocketWebhookNormalizedScan[] = [];

  if (Array.isArray(scansRaw)) {
    if (scansRaw.length > MAX_SCANS) {
      return { action: "reject", reason: "too_many_scans" };
    }
    for (const item of scansRaw) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }
      const normalized = scanToNormalized({
        awb,
        srOrderId,
        orderId,
        isReturn,
        topStatus,
        topStatusId,
        topTimestamp,
        scan: item as Record<string, unknown>,
      });
      if (normalized) {
        scans.push(normalized);
      }
    }
  }

  if (scans.length === 0) {
    const syntheticScan: Record<string, unknown> = {
      current_status: topStatus,
      current_timestamp: topTimestamp,
      current_status_id: topStatusId,
      shipment_status_id: readIdString(root.shipment_status_id),
    };
    const topLevel = scanToNormalized({
      awb,
      srOrderId,
      orderId,
      isReturn,
      topStatus,
      topStatusId,
      topTimestamp,
      scan: syntheticScan,
    });
    if (topLevel) {
      scans.push(topLevel);
    }
  }

  if (scans.length === 0) {
    return {
      action: "ignore",
      reason: "no_trackable_status_or_timestamp",
      providerOrderId: srOrderId ?? orderId,
      providerAwb: awb,
      srOrderId,
      orderId,
    };
  }

  return {
    action: "events",
    eventType: "TRACKING_UPDATE",
    providerOrderId: srOrderId ?? orderId,
    providerAwb: awb,
    isReturn,
    srOrderId,
    orderId,
    scans,
  };
}

export function hashShiprocketWebhookPayload(rawBody: string): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

export function shiprocketWebhookProviderEventKey(payloadHash: string): string {
  return `SHIPROCKET:TRACKING:${payloadHash}`;
}
