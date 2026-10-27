import { env } from "../../../../config/env.js";
import type { CancellationRequest } from "../../contracts/cancellation.js";
import type { NormalizedCancellationResult } from "../../contracts/cancellation.js";
import type { NormalizedBookingResult } from "../../contracts/booking.js";
import type { NormalizedTrackingResult } from "../../contracts/tracking.js";
import { ProviderAdapterError } from "../../contracts/provider-error.js";
import type { AdapterExecutionContext } from "../provider-adapter.types.js";
import { ProviderHttpClient } from "../provider-http-client.js";
import {
  SHIPROCKET_CANCEL_ORDERS_PATH,
  SHIPROCKET_ORDER_SHOW_PATH_PREFIX,
  SHIPROCKET_TRACK_AWB_PATH_PREFIX,
  SHIPROCKET_TRACK_SHIPMENT_PATH_PREFIX,
} from "./shiprocket.constants.js";
import {
  ShiprocketAuthService,
  shiprocketAuthService,
} from "./shiprocket-auth.service.js";
import {
  shiprocketOrderShowResponseSchema,
  shiprocketTrackingResponseSchema,
} from "./shiprocket.types.js";

function assertLifecycleEnabled(
  operation: "getBooking" | "cancelBooking" | "getTracking",
): void {
  if (!env.SHIPROCKET_BOOKING_ENABLED && env.NODE_ENV !== "test") {
    throw new ProviderAdapterError({
      providerCode: "SHIPROCKET",
      operation,
      category: "PROVIDER_UNSUPPORTED_OPERATION",
      safeMessage: "Shiprocket booking lifecycle is disabled.",
      retryable: false,
    });
  }
}

function mapTrackingStatus(raw: unknown): string {
  if (typeof raw === "string" && raw.length > 0) {
    return raw;
  }
  if (typeof raw === "number") {
    return String(raw);
  }
  return "UNKNOWN";
}

export class ShiprocketLifecycleService {
  constructor(
    private readonly http: ProviderHttpClient = new ProviderHttpClient(),
    private readonly auth: ShiprocketAuthService = shiprocketAuthService,
  ) {}

  async getBooking(
    providerBookingId: string,
    ctx: AdapterExecutionContext,
  ): Promise<NormalizedBookingResult> {
    assertLifecycleEnabled("getBooking");
    const token = await this.auth.getBearerToken({
      config: ctx.config,
      requestId: ctx.requestId,
    });

    const response = await this.http.request({
      config: ctx.config,
      operation: "getBooking",
      requestId: ctx.requestId,
      request: {
        method: "GET",
        path: `${SHIPROCKET_ORDER_SHOW_PATH_PREFIX}${encodeURIComponent(providerBookingId)}`,
        headers: { authorization: `Bearer ${token}` },
      },
      allowErrorResponseBody: true,
    });

    if (response.status === 404) {
      throw new ProviderAdapterError({
        providerCode: "SHIPROCKET",
        operation: "getBooking",
        category: "PROVIDER_NOT_FOUND",
        safeMessage: "Shiprocket order not found.",
        retryable: false,
        requestId: ctx.requestId,
      });
    }

    if (response.status < 200 || response.status >= 300) {
      throw new ProviderAdapterError({
        providerCode: "SHIPROCKET",
        operation: "getBooking",
        category: "PROVIDER_UNKNOWN_ERROR",
        safeMessage: "Shiprocket order lookup failed.",
        requestId: ctx.requestId,
      });
    }

    const parsed = shiprocketOrderShowResponseSchema.safeParse(response.data);
    const row = parsed.success ? parsed.data.data : undefined;
    const awb = row && typeof row.awb_code === "string" ? row.awb_code : null;
    const shipmentId =
      row?.shipments?.[0] && typeof row.shipments[0].id !== "undefined"
        ? String(row.shipments[0].id as string | number)
        : null;

    return {
      success: true,
      outcome: "BOOKED",
      providerBookingId,
      providerReference: shipmentId,
      status: row?.status ?? "UNKNOWN",
      bookedAt: null,
      estimatedPickupAt: null,
      estimatedDeliveryAt: null,
      trackingUrl: awb ? `${ctx.config.baseUrl}/track/${awb}` : null,
      driver: null,
      service: null,
      reason: null,
      metadata: {
        shiprocketAwbCode: awb,
        shiprocketShipmentId: shipmentId,
      },
    };
  }

  async cancelBooking(
    request: CancellationRequest,
    ctx: AdapterExecutionContext,
  ): Promise<NormalizedCancellationResult> {
    assertLifecycleEnabled("cancelBooking");
    const orderId = Number.parseInt(request.providerBookingId, 10);
    if (!Number.isFinite(orderId)) {
      throw new ProviderAdapterError({
        providerCode: "SHIPROCKET",
        operation: "cancelBooking",
        category: "PROVIDER_VALIDATION_ERROR",
        safeMessage: "Shiprocket order id must be numeric.",
        retryable: false,
        requestId: ctx.requestId,
      });
    }

    const token = await this.auth.getBearerToken({
      config: ctx.config,
      requestId: ctx.requestId,
    });

    const response = await this.http.request({
      config: ctx.config,
      operation: "cancelBooking",
      requestId: ctx.requestId,
      request: {
        method: "POST",
        path: SHIPROCKET_CANCEL_ORDERS_PATH,
        headers: { authorization: `Bearer ${token}` },
        body: { ids: [orderId] },
      },
      allowErrorResponseBody: true,
    });

    if (response.status === 204 || (response.status >= 200 && response.status < 300)) {
      return {
        success: true,
        outcome: "CANCELLED",
        providerCancellationId: String(orderId),
        status: "CANCELLED",
        reason: request.reason ?? null,
        cancelledAt: new Date().toISOString(),
      };
    }

    if (response.status === 422) {
      return {
        success: false,
        outcome: "REJECTED",
        providerCancellationId: null,
        status: "REJECTED",
        reason: "Shiprocket rejected cancellation.",
        cancelledAt: null,
      };
    }

    throw new ProviderAdapterError({
      providerCode: "SHIPROCKET",
      operation: "cancelBooking",
      category: "PROVIDER_UNKNOWN_ERROR",
      safeMessage: "Shiprocket cancellation failed.",
      requestId: ctx.requestId,
    });
  }

  async getTracking(
    providerBookingId: string,
    ctx: AdapterExecutionContext,
    options?: { awbCode?: string | null; shipmentId?: string | null },
  ): Promise<NormalizedTrackingResult> {
    assertLifecycleEnabled("getTracking");
    const token = await this.auth.getBearerToken({
      config: ctx.config,
      requestId: ctx.requestId,
    });

    let awbCode = options?.awbCode ?? null;
    let shipmentId = options?.shipmentId ?? null;

    if (!awbCode && !shipmentId) {
      const booking = await this.getBooking(providerBookingId, ctx);
      awbCode =
        typeof booking.metadata?.shiprocketAwbCode === "string"
          ? booking.metadata.shiprocketAwbCode
          : null;
      shipmentId =
        typeof booking.metadata?.shiprocketShipmentId === "string"
          ? booking.metadata.shiprocketShipmentId
          : booking.providerReference;
    }

    const path = awbCode
      ? `${SHIPROCKET_TRACK_AWB_PATH_PREFIX}${encodeURIComponent(awbCode)}`
      : shipmentId
        ? `${SHIPROCKET_TRACK_SHIPMENT_PATH_PREFIX}${encodeURIComponent(shipmentId)}`
        : null;

    if (!path) {
      throw new ProviderAdapterError({
        providerCode: "SHIPROCKET",
        operation: "getTracking",
        category: "PROVIDER_NOT_FOUND",
        safeMessage: "Shiprocket tracking identifiers are not available yet.",
        retryable: false,
        requestId: ctx.requestId,
      });
    }

    const response = await this.http.request({
      config: ctx.config,
      operation: "getTracking",
      requestId: ctx.requestId,
      request: {
        method: "GET",
        path,
        headers: { authorization: `Bearer ${token}` },
      },
      allowErrorResponseBody: true,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new ProviderAdapterError({
        providerCode: "SHIPROCKET",
        operation: "getTracking",
        category: "PROVIDER_UNKNOWN_ERROR",
        safeMessage: "Shiprocket tracking lookup failed.",
        requestId: ctx.requestId,
      });
    }

    const parsed = shiprocketTrackingResponseSchema.safeParse(response.data);
    const status = parsed.success
      ? mapTrackingStatus(parsed.data.shipment_status)
      : "UNKNOWN";

    return {
      status,
      latitude: null,
      longitude: null,
      accuracyMeters: null,
      providerTimestamp: null,
      receivedAt: new Date().toISOString(),
      eta: null,
      trackingUrl: awbCode ? `${ctx.config.baseUrl}/track/${awbCode}` : null,
      driver: null,
      providerEventId: null,
    };
  }
}

export const shiprocketLifecycleService = new ShiprocketLifecycleService();
