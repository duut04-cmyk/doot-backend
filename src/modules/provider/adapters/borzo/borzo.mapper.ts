import type { AvailabilityResult } from "../../contracts/availability.js";
import type { NormalizedQuote, QuoteRequest } from "../../contracts/quote.js";
import type { NormalizedServiceabilityResult } from "../../contracts/serviceability.js";
import {
  BORZO_DEFAULT_VEHICLE_TYPE_ID,
  BORZO_MATTER_BY_PACKAGE_TYPE,
  BORZO_ORDER_TYPE_STANDARD,
} from "./borzo.constants.js";
import type {
  BorzoCalculateOrderRequest,
  BorzoCalculateOrderResponse,
  BorzoProviderMetadata,
} from "./borzo.types.js";

export type BorzoProbeQuoteResult = {
  quote: NormalizedQuote;
  serviceability: NormalizedServiceabilityResult;
  availability: AvailabilityResult;
  warnings: string[];
  providerMetadata: BorzoProviderMetadata;
};

export function toBorzoPhone(e164Phone: string): string {
  return e164Phone.replace(/\D/g, "");
}

export function mapPackageTypeToMatter(request: QuoteRequest): string {
  const mapped = BORZO_MATTER_BY_PACKAGE_TYPE[request.package.packageType];
  if (mapped) {
    return mapped;
  }
  if (request.package.description?.trim()) {
    return request.package.description.trim().slice(0, 5000);
  }
  return BORZO_MATTER_BY_PACKAGE_TYPE.OTHER ?? "General goods";
}

export function mapQuoteRequestToBorzoCalculateOrder(
  request: QuoteRequest,
): BorzoCalculateOrderRequest {
  const matter = mapPackageTypeToMatter(request);
  const totalWeightKg = Math.max(1, Math.ceil(request.package.weightKg));

  const pickupPoint = {
    address: request.pickup.addressText,
    contact_person: {
      phone: toBorzoPhone(request.pickup.contactPhone),
      name: request.pickup.contactName,
    },
    ...(request.pickup.instructions
      ? { note: request.pickup.instructions }
      : {}),
    ...(request.schedule.mode === "SCHEDULED" && request.schedule.windowStart
      ? { required_start_datetime: request.schedule.windowStart }
      : {}),
    ...(request.schedule.mode === "SCHEDULED" && request.schedule.windowEnd
      ? { required_finish_datetime: request.schedule.windowEnd }
      : {}),
  };

  const dropPoint = {
    address: request.drop.addressText,
    contact_person: {
      phone: toBorzoPhone(request.drop.contactPhone),
      name: request.drop.contactName,
    },
    ...(request.drop.instructions ? { note: request.drop.instructions } : {}),
  };

  return {
    type: BORZO_ORDER_TYPE_STANDARD,
    matter,
    vehicle_type_id: BORZO_DEFAULT_VEHICLE_TYPE_ID,
    total_weight_kg: totalWeightKg,
    points: [pickupPoint, dropPoint],
  };
}

function parseMoney(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === "") {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sumOptionalAmounts(values: Array<number | null>): number {
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function hasParameterWarnings(parameterWarnings: unknown): boolean {
  if (parameterWarnings === null || parameterWarnings === undefined) {
    return false;
  }
  if (Array.isArray(parameterWarnings)) {
    return parameterWarnings.length > 0;
  }
  if (typeof parameterWarnings === "object") {
    return Object.keys(parameterWarnings as Record<string, unknown>).length > 0;
  }
  return true;
}

function extractEstimatedDeliveryAt(
  response: BorzoCalculateOrderResponse,
): string | null {
  const points = response.order?.points;
  if (!points?.length) {
    return null;
  }
  const lastPoint = points[points.length - 1];
  const eta = lastPoint?.estimated_arrival_datetime;
  if (!eta) {
    return null;
  }
  const parsed = Date.parse(eta);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function buildServiceabilityReason(
  response: BorzoCalculateOrderResponse,
  warnings: string[],
): string | null {
  if (!response.is_successful) {
    const errors = response.errors ?? [];
    if (errors.length > 0) {
      return `Provider rejected parameters: ${errors.join(", ")}`;
    }
    return "Provider rejected the delivery parameters.";
  }
  if (warnings.length > 0) {
    return `Provider reported warnings: ${warnings.join(", ")}`;
  }
  if (hasParameterWarnings(response.parameter_warnings)) {
    return "Provider reported parameter warnings.";
  }
  return null;
}

function isServiceable(response: BorzoCalculateOrderResponse): boolean {
  if (!response.is_successful) {
    return false;
  }
  const warnings = response.warnings ?? [];
  if (warnings.length > 0) {
    return false;
  }
  if (hasParameterWarnings(response.parameter_warnings)) {
    return false;
  }
  return true;
}

function buildProviderMetadata(
  response: BorzoCalculateOrderResponse,
): BorzoProviderMetadata {
  const order = response.order;
  return {
    borzoOrderId:
      order?.order_id !== null && order?.order_id !== undefined
        ? String(order.order_id)
        : null,
    borzoOrderType: order?.type ?? null,
    borzoVehicleTypeId: order?.vehicle_type_id ?? null,
    feeBreakdown: {
      deliveryFee: order?.delivery_fee_amount ?? null,
      weightFee: order?.weight_fee_amount ?? null,
      insuranceFee: order?.insurance_fee_amount ?? null,
      loadingFee: order?.loading_fee_amount ?? null,
      moneyTransferFee: order?.money_transfer_fee_amount ?? null,
      promoDiscount: order?.promo_code_discount_amount ?? null,
      backpayment: order?.backpayment_amount ?? null,
      codFee: order?.cod_fee_amount ?? null,
      returnFee: order?.return_fee_amount ?? null,
      waitingFee: order?.waiting_fee_amount ?? null,
    },
  };
}

export function mapBorzoCalculateOrderToProbeResult(
  response: BorzoCalculateOrderResponse,
  _request: QuoteRequest,
): BorzoProbeQuoteResult {
  const now = new Date().toISOString();
  const warnings = response.warnings ?? [];
  const serviceable = isServiceable(response);
  const paymentAmount = parseMoney(response.order?.payment_amount);
  const deliveryFee = parseMoney(response.order?.delivery_fee_amount);
  const weightFee = parseMoney(response.order?.weight_fee_amount);
  const otherCharges = sumOptionalAmounts([
    parseMoney(response.order?.insurance_fee_amount),
    parseMoney(response.order?.loading_fee_amount),
    parseMoney(response.order?.money_transfer_fee_amount),
    parseMoney(response.order?.cod_fee_amount),
    parseMoney(response.order?.return_fee_amount),
    parseMoney(response.order?.waiting_fee_amount),
    weightFee,
  ]);
  const estimatedDeliveryAt = extractEstimatedDeliveryAt(response);
  const providerMetadata = buildProviderMetadata(response);

  const quoteAvailable =
    response.is_successful && paymentAmount !== null && serviceable;

  const quote: NormalizedQuote = {
    available: quoteAvailable,
    amount:
      quoteAvailable && paymentAmount !== null
        ? { amount: paymentAmount, currency: "INR" }
        : null,
    providerQuoteId: providerMetadata.borzoOrderId,
    estimatedDeliveryAt,
    estimatedDeliveryMinutes: null,
    breakdown:
      quoteAvailable && paymentAmount !== null
        ? {
            baseAmount: deliveryFee,
            distanceCharge: null,
            surgeAmount: null,
            taxAmount: null,
            otherCharges: otherCharges > 0 ? otherCharges : null,
            totalAmount: paymentAmount,
          }
        : null,
    quotedAt: now,
    reason: quoteAvailable
      ? null
      : buildServiceabilityReason(response, warnings),
  };

  const serviceability: NormalizedServiceabilityResult = {
    serviceable,
    providerReference: providerMetadata.borzoOrderId,
    reason: buildServiceabilityReason(response, warnings),
    availableServices: serviceable
      ? [
          {
            serviceId: providerMetadata.borzoOrderId,
            serviceCode: response.order?.type ?? BORZO_ORDER_TYPE_STANDARD,
            serviceName: `Borzo ${response.order?.type ?? BORZO_ORDER_TYPE_STANDARD}`,
            vehicleType: null,
            available: true,
            packageCompatible: true,
            estimatedPickupEta: response.order?.points?.[0]
              ?.estimated_arrival_datetime
              ? new Date(
                  response.order.points[0].estimated_arrival_datetime!,
                ).toISOString()
              : null,
            estimatedDeliveryEta: estimatedDeliveryAt,
          },
        ]
      : [],
    checkedAt: now,
  };

  const availability: AvailabilityResult = {
    known: false,
    available: false,
    availableDriverCount: null,
    drivers: null,
    checkedAt: now,
    reason:
      "Driver availability is not provided by price calculation.",
  };

  return {
    quote,
    serviceability,
    availability,
    warnings,
    providerMetadata,
  };
}

export function mapBorzoCalculateOrderToQuote(
  response: BorzoCalculateOrderResponse,
  request: QuoteRequest,
): NormalizedQuote {
  return mapBorzoCalculateOrderToProbeResult(response, request).quote;
}

export function assertBorzoPhase4Environment(
  environment: string,
  baseUrl: string,
): void {
  if (environment === "LIVE") {
    throw new Error("Production Borzo is not enabled in Phase 4.");
  }
  const host = new URL(baseUrl).hostname.toLowerCase();
  if (host !== "robotapitest-in.borzodelivery.com") {
    throw new Error("Borzo base URL host is not allowed for Phase 4.");
  }
}
