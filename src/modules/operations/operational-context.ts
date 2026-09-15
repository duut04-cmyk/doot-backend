import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import {
  bookingRepository,
  type IBookingRepository,
} from "../booking/booking.repository.js";
import type { ProviderBookingDto } from "../booking/booking.types.js";

export async function requireBookedProviderBooking(
  deliveryId: string,
  bookingRepo: IBookingRepository = bookingRepository,
): Promise<ProviderBookingDto> {
  const booking = await bookingRepo.findLatestBookedByDeliveryId(deliveryId);
  if (!booking) {
    throw new AppError("Active provider booking not found.", {
      statusCode: 422,
      code: ErrorCodes.BOOKING_NOT_FOUND,
    });
  }
  if (!booking.providerOrderId) {
    throw new AppError("Provider booking reference is unavailable.", {
      statusCode: 422,
      code: ErrorCodes.BOOKING_UNKNOWN,
    });
  }
  return booking;
}
