import type { DeliveryDetailDto } from "../../delivery/delivery.types.js";
import type { AvailabilityRequest } from "../contracts/availability.js";
import type { BookingRequest } from "../contracts/booking.js";
import type { QuoteRequest } from "../contracts/quote.js";
import type { ServiceabilityRequest } from "../contracts/serviceability.js";

function mapDeliveryCore(delivery: DeliveryDetailDto) {
  return {
    deliveryId: delivery.id,
    deliveryReference: delivery.reference,
    pickup: {
      addressText: delivery.pickup.addressText,
      contactName: delivery.pickup.contactName,
      contactPhoneCountryCode: delivery.pickup.contactPhone.countryCode,
      contactPhoneNumber: delivery.pickup.contactPhone.number,
      instructions: delivery.pickup.instructions,
      latitude: delivery.pickup.latitude,
      longitude: delivery.pickup.longitude,
    },
    drop: {
      addressText: delivery.drop.addressText,
      contactName: delivery.drop.contactName,
      contactPhoneCountryCode: delivery.drop.contactPhone.countryCode,
      contactPhoneNumber: delivery.drop.contactPhone.number,
      instructions: delivery.drop.instructions,
      latitude: delivery.drop.latitude,
      longitude: delivery.drop.longitude,
    },
    package: {
      packageType: delivery.package.packageType,
      weightKg: delivery.package.weightKg,
      lengthCm: delivery.package.lengthCm,
      widthCm: delivery.package.widthCm,
      heightCm: delivery.package.heightCm,
      quantity: delivery.package.quantity,
      description: delivery.package.description,
    },
    schedule: {
      mode: delivery.schedule.mode,
      timezone: delivery.schedule.timezone,
      scheduledAt: delivery.schedule.scheduledAt,
      windowStart: delivery.schedule.windowStart,
      windowEnd: delivery.schedule.windowEnd,
    },
    requirements: delivery.requirements,
    specialInstructions: delivery.specialInstructions,
  };
}

export function toServiceabilityRequest(
  delivery: DeliveryDetailDto,
): ServiceabilityRequest {
  return mapDeliveryCore(delivery);
}

export function toAvailabilityRequest(
  delivery: DeliveryDetailDto,
  options?: { serviceCode?: string },
): AvailabilityRequest {
  return {
    ...mapDeliveryCore(delivery),
    serviceCode: options?.serviceCode,
  };
}

export function toQuoteRequest(
  delivery: DeliveryDetailDto,
  options?: { serviceCode?: string },
): QuoteRequest {
  return {
    ...mapDeliveryCore(delivery),
    serviceCode: options?.serviceCode,
  };
}

export function toBookingRequest(
  delivery: DeliveryDetailDto,
  options?: {
    serviceCode?: string;
    providerQuoteId?: string | null;
    idempotencyKey?: string;
  },
): BookingRequest {
  return {
    ...mapDeliveryCore(delivery),
    serviceCode: options?.serviceCode,
    providerQuoteId: options?.providerQuoteId ?? null,
    idempotencyKey: options?.idempotencyKey,
  };
}
