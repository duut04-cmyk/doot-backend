import type { UserRole } from "@prisma/client";
import type {
  AdminBookingDto,
  AdminConfirmResultDto,
  BookingConfirmResponsePayload,
  CustomerBookingDto,
  CustomerConfirmResultDto,
  ProviderBookingDto,
} from "./booking.types.js";

function mapCustomerBooking(booking: ProviderBookingDto): CustomerBookingDto {
  return {
    id: booking.id,
    providerCode: booking.providerCode,
    serviceCode: booking.providerServiceCode,
    status: booking.status,
    providerReference: booking.providerReference,
    quote: {
      amount:
        booking.bookedAmount ??
        booking.quotedAmount ??
        booking.quoteSnapshot.amount,
      currency:
        booking.bookedCurrency ??
        booking.quotedCurrency ??
        booking.quoteSnapshot.currency,
    },
    bookedAt: booking.bookedAt?.toISOString() ?? null,
  };
}

function mapAdminBooking(booking: ProviderBookingDto): AdminBookingDto {
  return {
    ...mapCustomerBooking(booking),
    attemptNumber: booking.attemptNumber,
    orchestrationRequestId: booking.orchestrationRequestId,
    orchestrationOptionId: booking.orchestrationOptionId,
    providerId: booking.providerId,
    providerServiceId: booking.providerServiceId,
    correlationReference: booking.correlationReference,
    providerOrderId: booking.providerOrderId,
    providerStatus: booking.providerStatus,
    quotedAmount: booking.quotedAmount,
    quotedCurrency: booking.quotedCurrency,
    bookedAmount: booking.bookedAmount,
    bookedCurrency: booking.bookedCurrency,
    providerQuoteId: booking.providerQuoteId,
    quoteSnapshot: booking.quoteSnapshot,
    unknownOutcome: booking.unknownOutcome,
    failureCode: booking.failureCode,
    failureMessage: booking.failureMessage,
    requestId: booking.requestId,
    failedAt: booking.failedAt?.toISOString() ?? null,
    createdAt: booking.createdAt.toISOString(),
    updatedAt: booking.updatedAt.toISOString(),
  };
}

export function mapConfirmResponse(
  role: UserRole,
  delivery: { id: string; reference: string; status: string },
  booking: ProviderBookingDto,
): BookingConfirmResponsePayload {
  const customer: CustomerConfirmResultDto = {
    delivery: {
      id: delivery.id,
      reference: delivery.reference,
      status: delivery.status,
    },
    booking: mapCustomerBooking(booking),
  };
  if (role === "ADMIN") {
    const admin: AdminConfirmResultDto = {
      delivery: customer.delivery,
      booking: mapAdminBooking(booking),
    };
    return admin;
  }
  return customer;
}

export function mapBookingGetResponse(
  role: UserRole,
  delivery: { id: string; reference: string; status: string },
  booking: ProviderBookingDto,
) {
  return {
    success: true as const,
    data: mapConfirmResponse(role, delivery, booking),
  };
}
