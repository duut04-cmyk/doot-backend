import type { ProviderEnvironment } from "@prisma/client";
import { env } from "../../../../config/env.js";
import type { BookingRequest } from "../../contracts/booking.js";
import { ProviderAdapterError } from "../../contracts/provider-error.js";
import { SHIPROCKET_PROVIDER_CODE } from "./shiprocket.constants.js";
import { digitsOnlyPhone } from "./shiprocket-metadata.util.js";
import { buildShiprocketExternalOrderId } from "./shiprocket-order.util.js";

const SANDBOX_PIN_FALLBACK = 110001;
const SANDBOX_PLACEHOLDER = "NA";
const SANDBOX_BILLING_EMAIL = "booking@doot.local";

const INDIAN_POSTAL_CODE = /^\d{6}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isStrictLiveShiprocketBooking(
  environment: ProviderEnvironment,
): boolean {
  return environment === "LIVE";
}

function validationError(safeMessage: string): never {
  throw new ProviderAdapterError({
    providerCode: SHIPROCKET_PROVIDER_CODE,
    operation: "createBooking",
    category: "PROVIDER_VALIDATION_ERROR",
    safeMessage,
    retryable: false,
  });
}

function readMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveShiprocketPostcodePincode(input: {
  metadata: Record<string, unknown> | undefined;
  metadataKey: string;
  strictLive: boolean;
  label: string;
}): number {
  const raw = readMetadataString(input.metadata, input.metadataKey);
  if (raw && INDIAN_POSTAL_CODE.test(raw)) {
    return Number.parseInt(raw, 10);
  }
  if (input.strictLive) {
    validationError(`${input.label} PIN code is required for Shiprocket live booking.`);
  }
  return SANDBOX_PIN_FALLBACK;
}

export function resolveShiprocketCityState(input: {
  metadata: Record<string, unknown> | undefined;
  cityKey: string;
  stateKey: string;
  strictLive: boolean;
  label: string;
}): { city: string; state: string } {
  if (!input.strictLive) {
    return { city: SANDBOX_PLACEHOLDER, state: SANDBOX_PLACEHOLDER };
  }
  const city = readMetadataString(input.metadata, input.cityKey);
  const state = readMetadataString(input.metadata, input.stateKey);
  if (!city || city.toUpperCase() === SANDBOX_PLACEHOLDER) {
    validationError(`${input.label} city is required for Shiprocket live booking.`);
  }
  if (!state || state.toUpperCase() === SANDBOX_PLACEHOLDER) {
    validationError(`${input.label} state is required for Shiprocket live booking.`);
  }
  return { city: city.slice(0, 50), state: state.slice(0, 50) };
}

export function resolveShiprocketBillingEmail(input: {
  metadata: Record<string, unknown> | undefined;
  strictLive: boolean;
}): string {
  if (!input.strictLive) {
    return SANDBOX_BILLING_EMAIL;
  }
  const email = readMetadataString(input.metadata, "shiprocketBillingEmail");
  if (!email || !EMAIL_PATTERN.test(email)) {
    validationError(
      "shiprocketBillingEmail metadata is required for Shiprocket live booking.",
    );
  }
  return email.slice(0, 100);
}

function requireCoordinates(
  label: string,
  latitude: number | null | undefined,
  longitude: number | null | undefined,
  strictLive: boolean,
): { latitude: number; longitude: number } {
  if (
    latitude == null ||
    longitude == null ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    validationError(
      strictLive
        ? `${label} coordinates are required for Shiprocket live booking.`
        : `${label} coordinates are required for Shiprocket hyperlocal booking.`,
    );
  }
  return { latitude, longitude };
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

export function buildShiprocketAdhocOrderPayload(input: {
  request: BookingRequest;
  strictLive: boolean;
}): Record<string, unknown> {
  const pickupLocation = env.SHIPROCKET_PICKUP_LOCATION;
  if (!pickupLocation) {
    throw new ProviderAdapterError({
      providerCode: SHIPROCKET_PROVIDER_CODE,
      operation: "createBooking",
      category: "PROVIDER_VALIDATION_ERROR",
      safeMessage: "Shiprocket pickup location is not configured.",
      retryable: false,
    });
  }

  const { request, strictLive } = input;
  const metadata = request.providerMetadata;
  const orderId = buildShiprocketExternalOrderId(request);
  const billingPincode = resolveShiprocketPostcodePincode({
    metadata,
    metadataKey: "shiprocketPickupPostcode",
    strictLive,
    label: "Pickup",
  });
  const shippingPincode = resolveShiprocketPostcodePincode({
    metadata,
    metadataKey: "shiprocketDeliveryPostcode",
    strictLive,
    label: "Delivery",
  });
  const billingLocality = resolveShiprocketCityState({
    metadata,
    cityKey: "shiprocketPickupCity",
    stateKey: "shiprocketPickupState",
    strictLive,
    label: "Pickup",
  });
  const shippingLocality = resolveShiprocketCityState({
    metadata,
    cityKey: "shiprocketDeliveryCity",
    stateKey: "shiprocketDeliveryState",
    strictLive,
    label: "Delivery",
  });
  const billingEmail = resolveShiprocketBillingEmail({ metadata, strictLive });

  requireCoordinates(
    "Pickup",
    request.pickup.latitude,
    request.pickup.longitude,
    strictLive,
  );
  const dropCoords = requireCoordinates(
    "Drop",
    request.drop.latitude,
    request.drop.longitude,
    strictLive,
  );

  const now = new Date();
  const orderDate = `${now.toISOString().slice(0, 10)} ${now.toISOString().slice(11, 16)}`;
  const subTotal = resolveSubTotalInr(request);

  return {
    order_id: orderId,
    order_date: orderDate,
    pickup_location: pickupLocation,
    billing_customer_name: request.pickup.contactName.slice(0, 50),
    billing_address: request.pickup.addressText.slice(0, 200),
    billing_city: billingLocality.city,
    billing_pincode: billingPincode,
    billing_state: billingLocality.state,
    billing_country: "India",
    billing_email: billingEmail,
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
    shipping_city: shippingLocality.city,
    shipping_pincode: shippingPincode,
    shipping_state: shippingLocality.state,
    shipping_country: "India",
    shipping_phone: Number.parseInt(
      digitsOnlyPhone(
        request.drop.contactPhoneCountryCode,
        request.drop.contactPhoneNumber,
      ),
      10,
    ),
    latitude: dropCoords.latitude,
    longitude: dropCoords.longitude,
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
