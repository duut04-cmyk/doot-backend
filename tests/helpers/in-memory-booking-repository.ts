import { randomUUID } from "node:crypto";
import type { Prisma, ProviderBookingStatus } from "@prisma/client";
import type {
  BookingConfirmResponsePayload,
  ProviderBookingDto,
  QuoteSnapshot,
} from "../../src/modules/booking/booking.types.js";
import type {
  BookingConfirmIdempotencyRecord,
  IBookingRepository,
} from "../../src/modules/booking/booking.repository.js";

export class InMemoryBookingRepository implements IBookingRepository {
  bookings: ProviderBookingDto[] = [];
  idempotency: BookingConfirmIdempotencyRecord[] = [];

  async withTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const snapBookings = structuredClone(this.bookings);
    const snapIdempotency = structuredClone(this.idempotency);
    try {
      return await fn({} as Prisma.TransactionClient);
    } catch (error) {
      this.bookings = snapBookings;
      this.idempotency = snapIdempotency;
      throw error;
    }
  }

  async getNextAttemptNumber(deliveryId: string): Promise<number> {
    const latest = this.bookings
      .filter((booking) => booking.deliveryId === deliveryId)
      .sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
    return (latest?.attemptNumber ?? 0) + 1;
  }

  async findActiveByDeliveryId(
    deliveryId: string,
  ): Promise<ProviderBookingDto | null> {
    return (
      this.bookings.find(
        (booking) =>
          booking.deliveryId === deliveryId &&
          (booking.status === "PENDING" || booking.status === "BOOKING"),
      ) ?? null
    );
  }

  async findLatestBookedByDeliveryId(
    deliveryId: string,
  ): Promise<ProviderBookingDto | null> {
    return (
      this.bookings
        .filter(
          (booking) =>
            booking.deliveryId === deliveryId && booking.status === "BOOKED",
        )
        .sort((a, b) => b.attemptNumber - a.attemptNumber)[0] ?? null
    );
  }

  async findLatestByDeliveryId(
    deliveryId: string,
  ): Promise<ProviderBookingDto | null> {
    return (
      this.bookings
        .filter((booking) => booking.deliveryId === deliveryId)
        .sort((a, b) => b.attemptNumber - a.attemptNumber)[0] ?? null
    );
  }

  async findById(bookingId: string): Promise<ProviderBookingDto | null> {
    return this.bookings.find((booking) => booking.id === bookingId) ?? null;
  }

  async createBookingAttempt(input: {
    deliveryId: string;
    attemptNumber: number;
    orchestrationRequestId: string;
    orchestrationOptionId: string;
    providerId: string;
    providerServiceId: string | null;
    providerCode: string;
    providerServiceCode: string | null;
    correlationReference: string;
    quotedAmount: number | null;
    quotedCurrency: string | null;
    providerQuoteId: string | null;
    quoteSnapshot: QuoteSnapshot;
    requestId: string;
  }): Promise<ProviderBookingDto> {
    const active = await this.findActiveByDeliveryId(input.deliveryId);
    if (active) {
      throw new Error("Active booking already exists for delivery.");
    }

    const now = new Date();
    const booking: ProviderBookingDto = {
      id: randomUUID(),
      deliveryId: input.deliveryId,
      attemptNumber: input.attemptNumber,
      orchestrationRequestId: input.orchestrationRequestId,
      orchestrationOptionId: input.orchestrationOptionId,
      providerId: input.providerId,
      providerServiceId: input.providerServiceId,
      providerCode: input.providerCode,
      providerServiceCode: input.providerServiceCode,
      status: "BOOKING",
      correlationReference: input.correlationReference,
      providerOrderId: null,
      providerReference: null,
      providerStatus: null,
      quotedAmount: input.quotedAmount,
      quotedCurrency: input.quotedCurrency,
      bookedAmount: null,
      bookedCurrency: null,
      providerQuoteId: input.providerQuoteId,
      quoteSnapshot: input.quoteSnapshot,
      unknownOutcome: false,
      failureCode: null,
      failureMessage: null,
      requestId: input.requestId,
      bookedAt: null,
      failedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.bookings.push(booking);
    return booking;
  }

  async finalizeBooking(input: {
    bookingId: string;
    status: ProviderBookingStatus;
    providerOrderId?: string | null;
    providerReference?: string | null;
    providerStatus?: string | null;
    bookedAmount?: number | null;
    bookedCurrency?: string | null;
    quotedAmount?: number | null;
    quotedCurrency?: string | null;
    providerQuoteId?: string | null;
    quoteSnapshot?: QuoteSnapshot;
    unknownOutcome?: boolean;
    failureCode?: string | null;
    failureMessage?: string | null;
    bookedAt?: Date | null;
    failedAt?: Date | null;
  }): Promise<ProviderBookingDto> {
    const booking = this.bookings.find((item) => item.id === input.bookingId);
    if (!booking) {
      throw new Error("Booking not found.");
    }
    booking.status = input.status;
    booking.providerOrderId = input.providerOrderId ?? null;
    booking.providerReference = input.providerReference ?? null;
    booking.providerStatus = input.providerStatus ?? null;
    booking.bookedAmount = input.bookedAmount ?? null;
    booking.bookedCurrency = input.bookedCurrency ?? null;
    if (input.quotedAmount !== undefined) booking.quotedAmount = input.quotedAmount;
    if (input.quotedCurrency !== undefined) {
      booking.quotedCurrency = input.quotedCurrency;
    }
    if (input.providerQuoteId !== undefined) {
      booking.providerQuoteId = input.providerQuoteId;
    }
    if (input.quoteSnapshot) booking.quoteSnapshot = input.quoteSnapshot;
    booking.unknownOutcome = input.unknownOutcome ?? false;
    booking.failureCode = input.failureCode ?? null;
    booking.failureMessage = input.failureMessage ?? null;
    booking.bookedAt = input.bookedAt ?? null;
    booking.failedAt = input.failedAt ?? null;
    booking.updatedAt = new Date();
    return booking;
  }

  async findConfirmIdempotency(
    customerId: string,
    key: string,
  ): Promise<BookingConfirmIdempotencyRecord | null> {
    return (
      this.idempotency.find(
        (item) => item.customerId === customerId && item.key === key,
      ) ?? null
    );
  }

  async saveConfirmIdempotency(input: {
    customerId: string;
    key: string;
    requestHash: string;
    deliveryId: string;
    responsePayload: BookingConfirmResponsePayload;
  }): Promise<void> {
    const existing = await this.findConfirmIdempotency(input.customerId, input.key);
    if (existing) {
      throw new Error("Idempotency key already exists.");
    }
    this.idempotency.push(input);
  }
}
