import { phoneFromProviderDigits } from "../../../../core/phone/phone.js";
import type { BookingRequest, NormalizedBookingResult } from "../../contracts/booking.js";
import type { NormalizedCancellationResult } from "../../contracts/cancellation.js";
import type { NormalizedDriver } from "../../contracts/common.js";
import type { NormalizedTrackingResult } from "../../contracts/tracking.js";
import {
  BORZO_CLIENT_ORDER_ID_MAX_LENGTH,
  BORZO_DEFAULT_VEHICLE_TYPE_ID,
  BORZO_ORDER_TYPE_STANDARD,
} from "./borzo.constants.js";
import { mapQuoteRequestToBorzoCalculateOrder } from "./borzo.mapper.js";
import type {
  BorzoCancelOrderResponse,
  BorzoCourier,
  BorzoCourierResponse,
  BorzoCreateOrderRequest,
  BorzoOrderDetail,
  BorzoCreateOrderResponse,
} from "./borzo.types.js";

function parseMoney(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === "") {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

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

function buildClientOrderId(request: BookingRequest): string {
  const source =
    request.idempotencyKey ??
    request.deliveryReference ??
    request.deliveryId ??
    "dutt-order";
  return source.slice(0, BORZO_CLIENT_ORDER_ID_MAX_LENGTH);
}

export function mapBookingRequestToBorzoCreateOrder(
  request: BookingRequest,
): BorzoCreateOrderRequest {
  const base = mapQuoteRequestToBorzoCalculateOrder(request);
  const clientOrderId = buildClientOrderId(request);

  return {
    ...base,
    type: base.type ?? BORZO_ORDER_TYPE_STANDARD,
    vehicle_type_id: base.vehicle_type_id ?? BORZO_DEFAULT_VEHICLE_TYPE_ID,
    points: base.points.map((point, index) => ({
      ...point,
      ...(index === 0 ? { client_order_id: clientOrderId } : {}),
    })),
  };
}

function buildOrderMetadata(order: BorzoOrderDetail | null | undefined) {
  if (!order) {
    return {};
  }
  return {
    borzoOrderId:
      order.order_id != null ? String(order.order_id) : null,
    borzoOrderName: order.order_name ?? null,
    borzoOrderStatus: order.status ?? null,
    borzoOrderStatusDescription: order.status_description ?? null,
    feeBreakdown: {
      deliveryFee: order.delivery_fee_amount ?? null,
      weightFee: order.weight_fee_amount ?? null,
      insuranceFee: order.insurance_fee_amount ?? null,
      loadingFee: order.loading_fee_amount ?? null,
      waitingFee: order.waiting_fee_amount ?? null,
      returnFee: order.return_fee_amount ?? null,
    },
    paymentMethod: order.payment_method ?? null,
    waybillDocumentUrl: order.waybill_document_url ?? null,
  };
}

function extractTrackingUrl(order: BorzoOrderDetail | null | undefined): string | null {
  if (!order?.points?.length) {
    return null;
  }
  for (const point of order.points) {
    if (point.tracking_url) {
      return point.tracking_url;
    }
  }
  return null;
}

function extractEstimatedDeliveryAt(
  order: BorzoOrderDetail | null | undefined,
): string | null {
  const points = order?.points;
  if (!points?.length) {
    return null;
  }
  const lastPoint = points[points.length - 1];
  return toIsoTimestamp(lastPoint?.estimated_arrival_datetime ?? null);
}

export function mapBorzoOrderToBookingResult(input: {
  response: BorzoCreateOrderResponse;
  request: BookingRequest;
}): NormalizedBookingResult {
  const { response, request } = input;
  const order = response.order;
  const now = new Date().toISOString();

  if (!response.is_successful || order?.order_id == null) {
    const errors = response.errors ?? [];
    const reason =
      errors.length > 0
        ? `Provider rejected booking: ${errors.join(", ")}`
        : "Provider rejected booking.";
    return {
      success: false,
      outcome: "FAILED",
      providerBookingId: null,
      providerReference: null,
      status: "REJECTED",
      bookedAt: null,
      estimatedPickupAt: null,
      estimatedDeliveryAt: null,
      trackingUrl: null,
      driver: null,
      service: null,
      reason,
      metadata: {
        errors: response.errors ?? null,
        parameterErrors: response.parameter_errors ?? null,
      },
    };
  }

  const paymentAmount = parseMoney(order.payment_amount);
  const driver = order.courier
    ? mapBorzoCourierToNormalizedDriver(order.courier)
    : null;

  return {
    success: true,
    outcome: "BOOKED",
    providerBookingId: String(order.order_id),
    providerReference: order.order_name ?? request.deliveryReference ?? null,
    status: order.status ?? order.status_description ?? "created",
    bookedAt: toIsoTimestamp(order.created_datetime) ?? now,
    estimatedPickupAt: toIsoTimestamp(order.points?.[0]?.estimated_arrival_datetime),
    estimatedDeliveryAt: extractEstimatedDeliveryAt(order),
    trackingUrl: extractTrackingUrl(order),
    driver,
    service: {
      serviceCode: order.type ?? BORZO_ORDER_TYPE_STANDARD,
      serviceName: order.type ? `Borzo ${order.type}` : "Borzo standard",
      vehicleType: null,
    },
    amount:
      paymentAmount != null
        ? { amount: paymentAmount, currency: "INR" }
        : null,
    reason: null,
    metadata: buildOrderMetadata(order),
  };
}

export function mapBorzoCourierToNormalizedDriver(
  courier: BorzoCourier | null | undefined,
): NormalizedDriver | null {
  if (!courier?.courier_id && !courier?.name && !courier?.phone) {
    return null;
  }

  const nameParts = [courier.name, courier.middlename, courier.surname]
    .filter((part) => part?.trim())
    .join(" ")
    .trim();

  const phone = courier.phone
    ? phoneFromProviderDigits(courier.phone)
    : null;

  return {
    providerDriverId:
      courier.courier_id != null ? String(courier.courier_id) : null,
    name: nameParts || null,
    phone: phone
      ? { countryCode: phone.countryCode, number: phone.number }
      : null,
    photoUrl: courier.photo_url ?? null,
    providerRating: null,
    vehicleType: null,
    vehicleNumber: null,
    assignedAt: new Date().toISOString(),
  };
}

export function mapBorzoTrackingResult(input: {
  order: BorzoOrderDetail | null | undefined;
  courierResponse: BorzoCourierResponse | null;
  providerBookingId: string;
}): NormalizedTrackingResult {
  const receivedAt = new Date().toISOString();
  const courier = input.courierResponse?.courier ?? input.order?.courier ?? null;
  const driver = mapBorzoCourierToNormalizedDriver(courier);

  const latitude =
    parseCoordinate(courier?.latitude) ??
    parseCoordinate(input.order?.points?.[0]?.latitude);
  const longitude =
    parseCoordinate(courier?.longitude) ??
    parseCoordinate(input.order?.points?.[0]?.longitude);

  const status =
    input.order?.status ??
    input.order?.status_description ??
    "unknown";

  return {
    status,
    latitude,
    longitude,
    accuracyMeters: null,
    providerTimestamp: toIsoTimestamp(input.order?.created_datetime),
    receivedAt,
    eta: extractEstimatedDeliveryAt(input.order),
    trackingUrl: extractTrackingUrl(input.order),
    driver,
    providerEventId: `borzo-tracking:${input.providerBookingId}:${receivedAt}`,
  };
}

export function mapBorzoCancelOrderToCancellationResult(
  response: BorzoCancelOrderResponse,
  providerBookingId: string,
): NormalizedCancellationResult {
  const now = new Date().toISOString();

  if (!response.is_successful) {
    const errors = response.errors ?? [];
    return {
      success: false,
      outcome: "REJECTED",
      providerCancellationId: null,
      status: "REJECTED",
      reason:
        errors.length > 0
          ? errors.join(", ")
          : "Provider rejected cancellation.",
      cancelledAt: null,
    };
  }

  const order = response.order;
  const cancelledStatus = order?.status === "canceled";

  return {
    success: true,
    outcome: "CANCELLED",
    providerCancellationId: order?.order_id
      ? String(order.order_id)
      : providerBookingId,
    status: order?.status ?? "canceled",
    reason: cancelledStatus
      ? order?.status_description ?? null
      : order?.status_description ?? null,
    cancelledAt: toIsoTimestamp(order?.finish_datetime) ?? now,
  };
}

export function parseBorzoOrderId(providerBookingId: string): number {
  const parsed = Number.parseInt(providerBookingId, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Invalid Borzo order id.");
  }
  return parsed;
}
