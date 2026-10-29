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
  SHIPROCKET_JSON_READ_HEADERS,
  SHIPROCKET_ORDER_SHOW_PATH_PREFIX,
  SHIPROCKET_PROVIDER_CODE,
  SHIPROCKET_TRACK_AWB_PATH_PREFIX,
  SHIPROCKET_TRACK_SHIPMENT_PATH_PREFIX,
} from "./shiprocket.constants.js";
import {
  ShiprocketAuthService,
  shiprocketAuthService,
} from "./shiprocket-auth.service.js";
import {
  isShiprocketCancelPreflightIndeterminate,
  isShiprocketOrderAlreadyCancelledAtProvider,
  isShiprocketOrderNonCancellableAtProvider,
  reconcileShiprocketCancelFromOrderShow,
  type ShiprocketCancelReconcileOutcome,
} from "./shiprocket-cancel.reconcile.js";
import { parseShiprocketCancelErrorReason } from "./shiprocket-cancel.util.js";
import {
  isValidShiprocketAwbCode,
  isValidShiprocketOrderId,
  isValidShiprocketShipmentId,
  parseShiprocketOrderShowDetails,
  type ShiprocketOrderShowDetails,
} from "./shiprocket-order-show.parse.js";
import {
  assertShiprocketHttpErrorResponse,
  assertShiprocketReadHttpSuccess,
} from "./shiprocket-read-http.util.js";
import {
  parseShiprocketTrackingResponse,
  toIsoDateTimeOrNull,
} from "./shiprocket-tracking.parse.js";

function assertLifecycleEnabled(
  operation: "getBooking" | "cancelBooking" | "getTracking",
): void {
  if (!env.SHIPROCKET_BOOKING_ENABLED && env.NODE_ENV !== "test") {
    throw new ProviderAdapterError({
      providerCode: SHIPROCKET_PROVIDER_CODE,
      operation,
      category: "PROVIDER_UNSUPPORTED_OPERATION",
      safeMessage: "Shiprocket booking lifecycle is disabled.",
      retryable: false,
    });
  }
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
    const details = await this.loadOrderShowDetails(
      providerBookingId,
      ctx,
      "getBooking",
    );

    const awbConfirmed = isValidShiprocketAwbCode(details.awbCode);
    const outcome = awbConfirmed ? ("BOOKED" as const) : ("UNKNOWN" as const);

    return {
      success: awbConfirmed,
      outcome,
      providerBookingId: details.orderId,
      providerReference: details.shipmentId,
      status: details.status,
      bookedAt: null,
      estimatedPickupAt: null,
      estimatedDeliveryAt: toIsoDateTimeOrNull(details.estimatedDelivery),
      trackingUrl: null,
      driver: null,
      service: null,
      reason: awbConfirmed
        ? null
        : "Shiprocket order exists but courier assignment (AWB) is not confirmed.",
      metadata: {
        shiprocketOrderId: details.orderId,
        shiprocketChannelOrderId: details.channelOrderId,
        shiprocketAwbCode: awbConfirmed ? details.awbCode : null,
        shiprocketShipmentId: details.shipmentId,
        shiprocketCourierId: details.courierId,
        shiprocketCourierName: details.courierName,
        shiprocketOrderStatusCode: details.statusCode,
        shiprocketOrderSubStatus: details.subStatus,
      },
    };
  }

  async cancelBooking(
    request: CancellationRequest,
    ctx: AdapterExecutionContext,
  ): Promise<NormalizedCancellationResult> {
    assertLifecycleEnabled("cancelBooking");
    const orderIdString = request.providerBookingId.trim();
    if (!isValidShiprocketOrderId(orderIdString)) {
      throw new ProviderAdapterError({
        providerCode: SHIPROCKET_PROVIDER_CODE,
        operation: "cancelBooking",
        category: "PROVIDER_VALIDATION_ERROR",
        safeMessage: "Shiprocket order id must be numeric.",
        retryable: false,
        requestId: ctx.requestId,
      });
    }
    const orderId = Number.parseInt(orderIdString, 10);

    try {
      const preCancelDetails = await this.loadOrderShowDetails(
        orderIdString,
        ctx,
        "cancelBooking",
      );
      if (isShiprocketOrderAlreadyCancelledAtProvider(preCancelDetails)) {
        return this.cancellationResultFromReconcile(
          orderIdString,
          "CONFIRMED_CANCELLED",
          request.reason ?? null,
        );
      }
      if (isShiprocketOrderNonCancellableAtProvider(preCancelDetails)) {
        return {
          success: false,
          outcome: "REJECTED",
          providerCancellationId: null,
          status: "REJECTED",
          reason: "Shiprocket order cannot be cancelled in its current state.",
          cancelledAt: null,
        };
      }
      if (isShiprocketCancelPreflightIndeterminate(preCancelDetails)) {
        return {
          success: false,
          outcome: "UNKNOWN",
          providerCancellationId: null,
          status: "UNKNOWN",
          reason:
            "Shiprocket order status could not be determined before cancellation.",
          cancelledAt: null,
        };
      }
    } catch (error) {
      if (error instanceof ProviderAdapterError) {
        if (
          error.category === "PROVIDER_TIMEOUT" ||
          error.category === "PROVIDER_SERVICE_UNAVAILABLE" ||
          error.category === "PROVIDER_UNKNOWN_ERROR"
        ) {
          return {
            success: false,
            outcome: "UNKNOWN",
            providerCancellationId: null,
            status: "UNKNOWN",
            reason: error.safeMessage,
            cancelledAt: null,
          };
        }
        throw error;
      }
      throw error;
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

    if (response.status === 422) {
      const parsedReason = parseShiprocketCancelErrorReason(response.data);
      return {
        success: false,
        outcome: "REJECTED",
        providerCancellationId: null,
        status: "REJECTED",
        reason: parsedReason ?? "Shiprocket rejected cancellation.",
        cancelledAt: null,
      };
    }

    if (response.status < 200 || response.status >= 300) {
      assertShiprocketHttpErrorResponse({
        status: response.status,
        operation: "cancelBooking",
        requestId: ctx.requestId,
        resourceLabel: "cancellation",
      });
    }

    try {
      const postCancelDetails = await this.loadOrderShowDetails(
        orderIdString,
        ctx,
        "cancelBooking",
      );
      const reconcile = reconcileShiprocketCancelFromOrderShow(postCancelDetails);
      return this.cancellationResultFromReconcile(
        orderIdString,
        reconcile,
        request.reason ?? null,
      );
    } catch (error) {
      if (error instanceof ProviderAdapterError) {
        return {
          success: false,
          outcome: "UNKNOWN",
          providerCancellationId: null,
          status: "UNKNOWN",
          reason: error.safeMessage,
          cancelledAt: null,
        };
      }
      return {
        success: false,
        outcome: "UNKNOWN",
        providerCancellationId: null,
        status: "UNKNOWN",
        reason: "Shiprocket cancellation outcome could not be confirmed.",
        cancelledAt: null,
      };
    }
  }

  private cancellationResultFromReconcile(
    orderIdString: string,
    reconcile: ShiprocketCancelReconcileOutcome,
    reason: string | null,
  ): NormalizedCancellationResult {
    if (reconcile === "CONFIRMED_CANCELLED") {
      return {
        success: true,
        outcome: "CANCELLED",
        providerCancellationId: orderIdString,
        status: "CANCELLED",
        reason,
        cancelledAt: new Date().toISOString(),
      };
    }
    if (reconcile === "STILL_ACTIVE") {
      return {
        success: false,
        outcome: "REJECTED",
        providerCancellationId: null,
        status: "REJECTED",
        reason: "Shiprocket order is still active after cancellation.",
        cancelledAt: null,
      };
    }
    return {
      success: false,
      outcome: "UNKNOWN",
      providerCancellationId: null,
      status: "UNKNOWN",
      reason: "Shiprocket cancellation could not be confirmed.",
      cancelledAt: null,
    };
  }

  private async loadOrderShowDetails(
    providerBookingId: string,
    ctx: AdapterExecutionContext,
    operation: "getBooking" | "cancelBooking",
  ): Promise<ShiprocketOrderShowDetails> {
    const token = await this.auth.getBearerToken({
      config: ctx.config,
      requestId: ctx.requestId,
    });

    const response = await this.http.request({
      config: ctx.config,
      operation,
      requestId: ctx.requestId,
      request: {
        method: "GET",
        path: `${SHIPROCKET_ORDER_SHOW_PATH_PREFIX}${encodeURIComponent(providerBookingId)}`,
        headers: {
          ...SHIPROCKET_JSON_READ_HEADERS,
          authorization: `Bearer ${token}`,
        },
      },
      allowErrorResponseBody: true,
    });

    assertShiprocketReadHttpSuccess({
      status: response.status,
      operation,
      requestId: ctx.requestId,
      resourceLabel: "order",
    });

    const details = parseShiprocketOrderShowDetails(response.data);
    if (!details) {
      throw new ProviderAdapterError({
        providerCode: SHIPROCKET_PROVIDER_CODE,
        operation,
        category: "PROVIDER_UNKNOWN_ERROR",
        safeMessage:
          "Shiprocket order lookup succeeded but the response could not be interpreted.",
        retryable: false,
        requestId: ctx.requestId,
      });
    }

    return details;
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

    let awbCode = isValidShiprocketAwbCode(options?.awbCode)
      ? options.awbCode.trim()
      : null;
    let shipmentId = isValidShiprocketShipmentId(options?.shipmentId)
      ? options.shipmentId.trim()
      : null;

    if (!awbCode && !shipmentId) {
      const booking = await this.getBooking(providerBookingId, ctx);
      const metaAwb = booking.metadata?.shiprocketAwbCode;
      awbCode = isValidShiprocketAwbCode(typeof metaAwb === "string" ? metaAwb : null)
        ? (metaAwb as string).trim()
        : null;
      const metaShipment = booking.metadata?.shiprocketShipmentId;
      shipmentId = isValidShiprocketShipmentId(
        typeof metaShipment === "string" ? metaShipment : booking.providerReference,
      )
        ? typeof metaShipment === "string"
          ? metaShipment.trim()
          : (booking.providerReference as string).trim()
        : null;
    }

    const path = awbCode
      ? `${SHIPROCKET_TRACK_AWB_PATH_PREFIX}${encodeURIComponent(awbCode)}`
      : shipmentId
        ? `${SHIPROCKET_TRACK_SHIPMENT_PATH_PREFIX}${encodeURIComponent(shipmentId)}`
        : null;

    if (!path) {
      throw new ProviderAdapterError({
        providerCode: SHIPROCKET_PROVIDER_CODE,
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
        headers: {
          ...SHIPROCKET_JSON_READ_HEADERS,
          authorization: `Bearer ${token}`,
        },
      },
      allowErrorResponseBody: true,
    });

    assertShiprocketReadHttpSuccess({
      status: response.status,
      operation: "getTracking",
      requestId: ctx.requestId,
      resourceLabel: "tracking",
    });

    const parsed = parseShiprocketTrackingResponse(response.data);
    if (parsed.availability === "UNKNOWN") {
      throw new ProviderAdapterError({
        providerCode: SHIPROCKET_PROVIDER_CODE,
        operation: "getTracking",
        category: "PROVIDER_UNKNOWN_ERROR",
        safeMessage: "Shiprocket tracking response could not be interpreted.",
        retryable: false,
        requestId: ctx.requestId,
      });
    }

    const receivedAt = new Date().toISOString();
    const metadata: Record<string, unknown> = {
      trackingAvailability: parsed.availability,
      shiprocketTrackStatus: parsed.trackStatus,
      shiprocketShipmentId: parsed.shipmentId,
      shiprocketOrderId: parsed.orderId,
      shiprocketAwbCode: parsed.awbCode,
      shiprocketCourierId: parsed.courierId,
      shiprocketCourierName: parsed.courierName,
      shiprocketPendingReason: parsed.pendingReason,
      shiprocketActivities: parsed.activities,
      shiprocketPickupDate: parsed.pickupDate,
      shiprocketDeliveredDate: parsed.deliveredDate,
    };

    return {
      status: parsed.rawStatus,
      latitude: null,
      longitude: null,
      accuracyMeters: null,
      providerTimestamp: parsed.activities[0]?.date
        ? toIsoDateTimeOrNull(parsed.activities[0].date)
        : null,
      receivedAt,
      eta: toIsoDateTimeOrNull(parsed.estimatedDelivery),
      trackingUrl: parsed.trackingUrl,
      driver: null,
      providerEventId: parsed.providerEventId,
      metadata,
    };
  }
}

export const shiprocketLifecycleService = new ShiprocketLifecycleService();
