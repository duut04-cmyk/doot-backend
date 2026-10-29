import { env } from "../../../../config/env.js";
import { AppError } from "../../../../core/errors/app-error.js";
import { ErrorCodes } from "../../../../core/errors/error-codes.js";
import type { BookingRequest } from "../../contracts/booking.js";
import type { NormalizedBookingResult } from "../../contracts/booking.js";
import { ProviderAdapterError } from "../../contracts/provider-error.js";
import type { AdapterExecutionContext } from "../provider-adapter.types.js";
import { ProviderHttpClient } from "../provider-http-client.js";
import {
  SHIPROCKET_ASSIGN_AWB_PATH,
  SHIPROCKET_CREATE_ADHOC_ORDER_PATH,
  SHIPROCKET_ORDER_SHOW_PATH_PREFIX,
} from "./shiprocket.constants.js";
import {
  digitsOnlyPhone,
  requireShiprocketCourierId,
} from "./shiprocket-metadata.util.js";
import { resolveOrderShowProbeResult } from "./shiprocket-order-show.probe.js";
import { confirmedShiprocketAwbCode } from "./shiprocket-order-show.parse.js";
import {
  bookingRequestChannelOrderId,
  buildShiprocketExternalOrderId,
  type ShiprocketCreatedOrderSnapshot,
} from "./shiprocket-order.util.js";
import {
  ShiprocketAuthService,
  shiprocketAuthService,
} from "./shiprocket-auth.service.js";
import {
  extractShiprocketAssignAwb,
  shiprocketAssignAwbResponseSchema,
  shiprocketCreateAdhocOrderResponseSchema,
} from "./shiprocket.types.js";

function assertBookingEnabled(): void {
  if (!env.SHIPROCKET_BOOKING_ENABLED && env.NODE_ENV !== "test") {
    throw new ProviderAdapterError({
      providerCode: "SHIPROCKET",
      operation: "createBooking",
      category: "PROVIDER_UNSUPPORTED_OPERATION",
      safeMessage: "Shiprocket booking is disabled.",
      retryable: false,
    });
  }
  const pickupLocation = env.SHIPROCKET_PICKUP_LOCATION;
  if (!pickupLocation) {
    throw new AppError("Shiprocket pickup location is not configured.", {
      statusCode: 503,
      code: ErrorCodes.PROVIDER_NOT_READY,
    });
  }
}

function resolveSubTotalInr(request: BookingRequest): number {
  const rate = request.providerMetadata?.shiprocketHyperlocalRate;
  if (rate && typeof rate === "object") {
    const row = rate as Record<string, unknown>;
    const raw = row.rates ?? row.rate;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return Math.max(1, Math.round(raw));
    }
    if (typeof raw === "string") {
      const parsed = Number.parseFloat(raw);
      if (Number.isFinite(parsed)) {
        return Math.max(1, Math.round(parsed));
      }
    }
  }
  return Math.max(1, Math.round(request.package.weightKg * 100));
}

function dimensionCm(value: number | null | undefined, fallback: number): number {
  return value != null && value > 0 ? value : fallback;
}

function parsePostcodeFromMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
  fallback: number,
): number {
  const value = metadata?.[key];
  if (typeof value === "string" && /^\d{6}$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return fallback;
}

function buildAdhocOrderPayload(request: BookingRequest): Record<string, unknown> {
  const pickupLocation = env.SHIPROCKET_PICKUP_LOCATION!;
  const orderId = buildShiprocketExternalOrderId(request);
  const billingPincode = parsePostcodeFromMetadata(
    request.providerMetadata,
    "shiprocketPickupPostcode",
    110001,
  );
  const shippingPincode = parsePostcodeFromMetadata(
    request.providerMetadata,
    "shiprocketDeliveryPostcode",
    110001,
  );
  const now = new Date();
  const orderDate = `${now.toISOString().slice(0, 10)} ${now.toISOString().slice(11, 16)}`;
  const subTotal = resolveSubTotalInr(request);

  const dropLat = request.drop.latitude;
  const dropLng = request.drop.longitude;
  if (dropLat == null || dropLng == null) {
    throw new ProviderAdapterError({
      providerCode: "SHIPROCKET",
      operation: "createBooking",
      category: "PROVIDER_VALIDATION_ERROR",
      safeMessage: "Drop coordinates are required for Shiprocket hyperlocal booking.",
      retryable: false,
    });
  }

  return {
    order_id: orderId,
    order_date: orderDate,
    pickup_location: pickupLocation,
    billing_customer_name: request.pickup.contactName.slice(0, 50),
    billing_address: request.pickup.addressText.slice(0, 200),
    billing_city: "NA",
    billing_pincode: billingPincode,
    billing_state: "NA",
    billing_country: "India",
    billing_email: "booking@doot.local",
    billing_phone: Number.parseInt(
      digitsOnlyPhone(
        request.pickup.contactPhoneCountryCode,
        request.pickup.contactPhoneNumber,
      ),
      10,
    ),
    shipping_is_billing: false,
    shipping_customer_name: request.drop.contactName.slice(0, 50),
    shipping_address: request.drop.addressText.slice(0, 200),
    shipping_city: "NA",
    shipping_pincode: shippingPincode,
    shipping_state: "NA",
    shipping_country: "India",
    shipping_phone: Number.parseInt(
      digitsOnlyPhone(
        request.drop.contactPhoneCountryCode,
        request.drop.contactPhoneNumber,
      ),
      10,
    ),
    latitude: dropLat,
    longitude: dropLng,
    payment_method: "Prepaid",
    shipping_method: "HL",
    sub_total: subTotal,
    length: dimensionCm(request.package.lengthCm, 10),
    breadth: dimensionCm(request.package.widthCm, 10),
    height: dimensionCm(request.package.heightCm, 10),
    weight: request.package.weightKg,
    order_items: [
      {
        name: request.package.description ?? request.package.packageType,
        sku: `DOOT-${request.package.packageType}`,
        units: request.package.quantity,
        selling_price: subTotal,
      },
    ],
  };
}

function parseCreateOrderResponse(body: unknown): ShiprocketCreatedOrderSnapshot {
  const parsed = shiprocketCreateAdhocOrderResponseSchema.safeParse(body);
  if (
    !parsed.success ||
    parsed.data.order_id == null ||
    parsed.data.shipment_id == null
  ) {
    throw new ProviderAdapterError({
      providerCode: "SHIPROCKET",
      operation: "createBooking",
      category: "PROVIDER_UNKNOWN_ERROR",
      safeMessage: "Shiprocket create order returned an unexpected response.",
      retryable: false,
    });
  }
  return {
    orderId: String(parsed.data.order_id),
    shipmentId: String(parsed.data.shipment_id),
    status: parsed.data.status ?? "NEW",
    awbCode: confirmedShiprocketAwbCode(
      typeof parsed.data.awb_code === "string" ? parsed.data.awb_code : null,
    ),
  };
}

function returnBookedWithAwb(input: {
  created: ShiprocketCreatedOrderSnapshot;
  awbCode: string;
  request: BookingRequest;
  ctx: AdapterExecutionContext;
  courierId: number;
  channelOrderId: string;
}): NormalizedBookingResult {
  const { created, awbCode, request, courierId, channelOrderId } = input;
  const confirmedAwb = confirmedShiprocketAwbCode(awbCode);
  if (!confirmedAwb) {
    return unknownAfterOrderCreated({
      created,
      channelOrderId,
      courierId,
      reason: "Shiprocket AWB was present but failed validation.",
    });
  }
  return {
    success: true,
    outcome: "BOOKED",
    providerBookingId: created.orderId,
    providerReference: created.shipmentId,
    status: created.status,
    bookedAt: new Date().toISOString(),
    estimatedPickupAt: null,
    estimatedDeliveryAt: null,
    trackingUrl: null,
    driver: null,
    service: request.serviceCode
      ? {
          serviceCode: request.serviceCode,
          serviceName: null,
          vehicleType: null,
        }
      : null,
    amount: null,
    reason: null,
    metadata: {
      shiprocketOrderId: created.orderId,
      shiprocketShipmentId: created.shipmentId,
      shiprocketAwbCode: confirmedAwb,
      shiprocketCourierId: courierId,
      shiprocketChannelOrderId: channelOrderId,
    },
  };
}

function unknownAfterOrderCreated(input: {
  created: ShiprocketCreatedOrderSnapshot;
  channelOrderId: string;
  reason: string;
  assignHttpStatus?: number;
  courierId?: number;
}): NormalizedBookingResult {
  return {
    success: false,
    outcome: "UNKNOWN",
    providerBookingId: input.created.orderId,
    providerReference: input.created.shipmentId,
    status: input.created.status,
    bookedAt: null,
    estimatedPickupAt: null,
    estimatedDeliveryAt: null,
    trackingUrl: null,
    driver: null,
    service: null,
    reason: input.reason,
    metadata: {
      shiprocketOrderId: input.created.orderId,
      shiprocketShipmentId: input.created.shipmentId,
      shiprocketChannelOrderId: input.channelOrderId,
      ...(input.courierId != null ? { shiprocketCourierId: input.courierId } : {}),
      ...(input.assignHttpStatus != null
        ? { shiprocketAssignAwbHttpStatus: input.assignHttpStatus }
        : {}),
    },
  };
}

export class ShiprocketBookingService {
  constructor(
    private readonly http: ProviderHttpClient = new ProviderHttpClient(),
    private readonly auth: ShiprocketAuthService = shiprocketAuthService,
  ) {}

  async createBooking(
    request: BookingRequest,
    ctx: AdapterExecutionContext,
  ): Promise<NormalizedBookingResult> {
    assertBookingEnabled();

    const channelOrderId = bookingRequestChannelOrderId(request);
    const courierId = requireShiprocketCourierId({
      providerMetadata: request.providerMetadata,
      providerQuoteId: request.providerQuoteId,
    });

    const token = await this.auth.getBearerToken({
      config: ctx.config,
      requestId: ctx.requestId,
    });

    let created =
      (await this.fetchExistingOrderSnapshot(channelOrderId, token, ctx)) ?? null;

    if (!created) {
      created = await this.createAdhocOrder(request, token, ctx, channelOrderId);
    }

    return this.assignAwbAndFinalize({
      request,
      ctx,
      token,
      created,
      courierId,
      channelOrderId,
    });
  }

  private async fetchExistingOrderSnapshot(
    lookupId: string,
    token: string,
    ctx: AdapterExecutionContext,
  ): Promise<ShiprocketCreatedOrderSnapshot | null> {
    const response = await this.http.request({
      config: ctx.config,
      operation: "getBooking",
      requestId: ctx.requestId,
      request: {
        method: "GET",
        path: `${SHIPROCKET_ORDER_SHOW_PATH_PREFIX}${encodeURIComponent(lookupId)}`,
        headers: { authorization: `Bearer ${token}` },
      },
      allowErrorResponseBody: true,
    });

    return resolveOrderShowProbeResult({
      status: response.status,
      data: response.data,
      operation: "getBooking",
      requestId: ctx.requestId,
    });
  }

  private async createAdhocOrder(
    request: BookingRequest,
    token: string,
    ctx: AdapterExecutionContext,
    channelOrderId: string,
  ): Promise<ShiprocketCreatedOrderSnapshot> {
    let createResponse;
    try {
      createResponse = await this.http.request({
        config: ctx.config,
        operation: "createBooking",
        requestId: ctx.requestId,
        request: {
          method: "POST",
          path: SHIPROCKET_CREATE_ADHOC_ORDER_PATH,
          headers: { authorization: `Bearer ${token}` },
          body: buildAdhocOrderPayload(request),
        },
        allowErrorResponseBody: true,
      });
    } catch (error) {
      if (error instanceof ProviderAdapterError) {
        const recovered = await this.fetchExistingOrderSnapshot(
          channelOrderId,
          token,
          ctx,
        );
        if (recovered) {
          return recovered;
        }
      }
      throw error;
    }

    if (createResponse.status === 498) {
      throw new ProviderAdapterError({
        providerCode: "SHIPROCKET",
        operation: "createBooking",
        category: "PROVIDER_SERVICE_UNAVAILABLE",
        safeMessage: "Shiprocket access was denied by edge infrastructure.",
        retryable: false,
        requestId: ctx.requestId,
      });
    }

    if (createResponse.status < 200 || createResponse.status >= 300) {
      const recovered = await this.fetchExistingOrderSnapshot(
        channelOrderId,
        token,
        ctx,
      );
      if (recovered) {
        return recovered;
      }
      throw new ProviderAdapterError({
        providerCode: "SHIPROCKET",
        operation: "createBooking",
        category:
          createResponse.status === 401
            ? "PROVIDER_AUTHENTICATION_ERROR"
            : "PROVIDER_VALIDATION_ERROR",
        safeMessage: "Shiprocket rejected the create order request.",
        retryable: false,
        requestId: ctx.requestId,
      });
    }

    return parseCreateOrderResponse(createResponse.data);
  }

  private async assignAwbAndFinalize(input: {
    request: BookingRequest;
    ctx: AdapterExecutionContext;
    token: string;
    created: ShiprocketCreatedOrderSnapshot;
    courierId: number;
    channelOrderId: string;
  }): Promise<NormalizedBookingResult> {
    const { request, ctx, token, created, courierId, channelOrderId } = input;

    let orderSnapshot = created;

    const existingAwb = confirmedShiprocketAwbCode(orderSnapshot.awbCode);
    if (existingAwb) {
      return returnBookedWithAwb({
        created: { ...orderSnapshot, awbCode: existingAwb },
        awbCode: existingAwb,
        request,
        ctx,
        courierId,
        channelOrderId,
      });
    }

    const awbBody = {
      shipment_id: Number.parseInt(orderSnapshot.shipmentId, 10),
      courier_id: courierId,
    };

    let assignResponse;
    try {
      assignResponse = await this.http.request({
        config: ctx.config,
        operation: "createBooking",
        requestId: ctx.requestId,
        request: {
          method: "POST",
          path: SHIPROCKET_ASSIGN_AWB_PATH,
          headers: { authorization: `Bearer ${token}` },
          body: awbBody,
        },
        allowErrorResponseBody: true,
      });
    } catch (error) {
      if (error instanceof ProviderAdapterError) {
        return unknownAfterOrderCreated({
          created: orderSnapshot,
          channelOrderId,
          courierId,
          reason: "Shiprocket order exists but AWB assignment could not be confirmed.",
        });
      }
      throw error;
    }

    if (assignResponse.status === 498) {
      return unknownAfterOrderCreated({
        created: orderSnapshot,
        channelOrderId,
        courierId,
        reason: "Shiprocket order created but AWB assignment could not be confirmed.",
        assignHttpStatus: assignResponse.status,
      });
    }

    if (assignResponse.status < 200 || assignResponse.status >= 300) {
      return unknownAfterOrderCreated({
        created: orderSnapshot,
        channelOrderId,
        courierId,
        reason: "Shiprocket order created but AWB assignment failed.",
        assignHttpStatus: assignResponse.status,
      });
    }

    shiprocketAssignAwbResponseSchema.parse(assignResponse.data);

    let awbCode = confirmedShiprocketAwbCode(
      extractShiprocketAssignAwb(assignResponse.data),
    );
    if (!awbCode) {
      const afterAssignShow = await this.fetchExistingOrderSnapshot(
        channelOrderId,
        token,
        ctx,
      );
      const showAwb = confirmedShiprocketAwbCode(afterAssignShow?.awbCode ?? null);
      if (showAwb && afterAssignShow) {
        awbCode = showAwb;
        orderSnapshot = {
          ...orderSnapshot,
          awbCode: showAwb,
          orderId: afterAssignShow.orderId,
          shipmentId: afterAssignShow.shipmentId,
          status: afterAssignShow.status,
        };
      }
    }

    if (!awbCode) {
      return unknownAfterOrderCreated({
        created: orderSnapshot,
        channelOrderId,
        courierId,
        reason:
          "Shiprocket AWB assignment was acknowledged but the AWB is not yet confirmed.",
      });
    }

    return returnBookedWithAwb({
      created: orderSnapshot,
      awbCode,
      request,
      ctx,
      courierId,
      channelOrderId,
    });
  }
}

export const shiprocketBookingService = new ShiprocketBookingService();

export { buildShiprocketExternalOrderId } from "./shiprocket-order.util.js";
