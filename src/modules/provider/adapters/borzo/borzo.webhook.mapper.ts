import { createHash } from "node:crypto";
import type { NormalizedProviderWebhookEvent } from "../../contracts/webhook.js";
import { BORZO_PROVIDER_CODE } from "./borzo.constants.js";
import {
  type BorzoDeliveryCallback,
  type BorzoOrderCallback,
  type BorzoWebhookCallback,
  isBorzoOrderCallback,
} from "./borzo.webhook.schemas.js";
import { mapBorzoCourierToNormalizedDriver } from "./borzo-operational.mapper.js";
import {
  normalizeBorzoDeliveryStatus,
  normalizeBorzoOrderStatus,
} from "./borzo.webhook.status.js";

function parseCoordinate(
  value: string | number | null | undefined,
): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoTimestamp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function hashWebhookPayload(rawBody: Buffer): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

export function buildBorzoProviderEventKey(callback: BorzoWebhookCallback): string {
  if (isBorzoOrderCallback(callback)) {
    const order = callback.order;
    const status = order.status ?? "";
    return [
      BORZO_PROVIDER_CODE,
      callback.event_type,
      "order",
      String(order.order_id),
      callback.event_datetime,
      status,
    ].join(":");
  }

  const delivery = callback.delivery;
  const status = delivery.status ?? "";
  const statusDatetime = delivery.status_datetime ?? "";
  return [
    BORZO_PROVIDER_CODE,
    callback.event_type,
    "delivery",
    String(delivery.delivery_id),
    callback.event_datetime,
    status,
    statusDatetime,
  ].join(":");
}

export function mapBorzoOrderCallbackToNormalizedEvent(
  callback: BorzoOrderCallback,
  receivedAt: string,
): NormalizedProviderWebhookEvent {
  const order = callback.order;
  const providerEventKey = buildBorzoProviderEventKey(callback);
  const rawStatus = order.status ?? null;

  return {
    providerCode: BORZO_PROVIDER_CODE,
    providerEventId: providerEventKey,
    eventType: callback.event_type,
    providerReference: null,
    providerBookingId: String(order.order_id),
    status: rawStatus,
    eventTimestamp: toIsoTimestamp(callback.event_datetime),
    receivedAt,
    driver: mapBorzoCourierToNormalizedDriver(order.courier),
    tracking: null,
    metadata: {
      callbackCategory: "order",
      borzoEventType: callback.event_type,
      providerOrderId: String(order.order_id),
      providerDeliveryId: null,
      providerStatusDescription: order.status_description ?? null,
      normalizedStatus: normalizeBorzoOrderStatus(rawStatus),
      orderType: order.type ?? null,
      vehicleTypeId: order.vehicle_type_id ?? null,
    },
  };
}

export function mapBorzoDeliveryCallbackToNormalizedEvent(
  callback: BorzoDeliveryCallback,
  receivedAt: string,
): NormalizedProviderWebhookEvent {
  const delivery = callback.delivery;
  const providerEventKey = buildBorzoProviderEventKey(callback);
  const rawStatus = delivery.status ?? null;
  const latitude = parseCoordinate(delivery.latitude);
  const longitude = parseCoordinate(delivery.longitude);

  return {
    providerCode: BORZO_PROVIDER_CODE,
    providerEventId: providerEventKey,
    eventType: callback.event_type,
    providerReference: String(delivery.delivery_id),
    providerBookingId:
      delivery.order_id !== null && delivery.order_id !== undefined
        ? String(delivery.order_id)
        : null,
    status: rawStatus,
    eventTimestamp: toIsoTimestamp(callback.event_datetime),
    receivedAt,
    driver: null,
    tracking: {
      status: rawStatus ?? "unknown",
      latitude,
      longitude,
      eta: null,
      trackingUrl: delivery.tracking_url ?? null,
    },
    metadata: {
      callbackCategory: "delivery",
      borzoEventType: callback.event_type,
      providerOrderId:
        delivery.order_id !== null && delivery.order_id !== undefined
          ? String(delivery.order_id)
          : null,
      providerDeliveryId: String(delivery.delivery_id),
      providerStatusDescription: delivery.status_description ?? null,
      normalizedStatus: normalizeBorzoDeliveryStatus(rawStatus),
      statusDatetime: delivery.status_datetime ?? null,
      pointId:
        delivery.point_id !== null && delivery.point_id !== undefined
          ? String(delivery.point_id)
          : null,
    },
  };
}

export function mapBorzoWebhookCallbackToNormalizedEvent(
  callback: BorzoWebhookCallback,
  receivedAt: string,
): NormalizedProviderWebhookEvent {
  if (isBorzoOrderCallback(callback)) {
    return mapBorzoOrderCallbackToNormalizedEvent(callback, receivedAt);
  }
  return mapBorzoDeliveryCallbackToNormalizedEvent(callback, receivedAt);
}

export function extractBorzoWebhookIds(callback: BorzoWebhookCallback): {
  providerOrderId: string | null;
  providerDeliveryId: string | null;
} {
  if (isBorzoOrderCallback(callback)) {
    return {
      providerOrderId: String(callback.order.order_id),
      providerDeliveryId: null,
    };
  }
  return {
    providerOrderId:
      callback.delivery.order_id !== null &&
      callback.delivery.order_id !== undefined
        ? String(callback.delivery.order_id)
        : null,
    providerDeliveryId: String(callback.delivery.delivery_id),
  };
}
