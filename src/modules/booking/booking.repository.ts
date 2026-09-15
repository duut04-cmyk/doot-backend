import type { Prisma, ProviderBookingStatus } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";
import { getPrismaClient } from "../../config/database.js";
import type {
  BookingConfirmResponsePayload,
  ProviderBookingDto,
  QuoteSnapshot,
} from "./booking.types.js";

export type BookingDbClient =
  | Prisma.TransactionClient
  | ReturnType<typeof getPrismaClient>;

function toDecimal(value: number | null): PrismaNamespace.Decimal | null {
  if (value == null) return null;
  return new PrismaNamespace.Decimal(value);
}

function mapBooking(row: {
  id: string;
  deliveryId: string;
  attemptNumber: number;
  orchestrationRequestId: string;
  orchestrationOptionId: string;
  providerId: string;
  providerServiceId: string | null;
  providerCode: string;
  providerServiceCode: string | null;
  status: ProviderBookingStatus;
  correlationReference: string;
  providerOrderId: string | null;
  providerReference: string | null;
  providerStatus: string | null;
  quotedAmount: PrismaNamespace.Decimal | null;
  quotedCurrency: string | null;
  bookedAmount: PrismaNamespace.Decimal | null;
  bookedCurrency: string | null;
  providerQuoteId: string | null;
  quoteSnapshot: unknown;
  unknownOutcome: boolean;
  failureCode: string | null;
  failureMessage: string | null;
  requestId: string | null;
  bookedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ProviderBookingDto {
  return {
    id: row.id,
    deliveryId: row.deliveryId,
    attemptNumber: row.attemptNumber,
    orchestrationRequestId: row.orchestrationRequestId,
    orchestrationOptionId: row.orchestrationOptionId,
    providerId: row.providerId,
    providerServiceId: row.providerServiceId,
    providerCode: row.providerCode,
    providerServiceCode: row.providerServiceCode,
    status: row.status,
    correlationReference: row.correlationReference,
    providerOrderId: row.providerOrderId,
    providerReference: row.providerReference,
    providerStatus: row.providerStatus,
    quotedAmount:
      row.quotedAmount == null ? null : Number(row.quotedAmount.toString()),
    quotedCurrency: row.quotedCurrency,
    bookedAmount:
      row.bookedAmount == null ? null : Number(row.bookedAmount.toString()),
    bookedCurrency: row.bookedCurrency,
    providerQuoteId: row.providerQuoteId,
    quoteSnapshot: row.quoteSnapshot as QuoteSnapshot,
    unknownOutcome: row.unknownOutcome,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    requestId: row.requestId,
    bookedAt: row.bookedAt,
    failedAt: row.failedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type BookingConfirmIdempotencyRecord = {
  customerId: string;
  key: string;
  requestHash: string;
  deliveryId: string;
  responsePayload: BookingConfirmResponsePayload;
};

export interface IBookingRepository {
  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
  getNextAttemptNumber(deliveryId: string): Promise<number>;
  findActiveByDeliveryId(deliveryId: string): Promise<ProviderBookingDto | null>;
  findLatestBookedByDeliveryId(deliveryId: string): Promise<ProviderBookingDto | null>;
  findLatestByDeliveryId(deliveryId: string): Promise<ProviderBookingDto | null>;
  findById(bookingId: string): Promise<ProviderBookingDto | null>;
  createBookingAttempt(
    input: {
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
    },
    client?: BookingDbClient,
  ): Promise<ProviderBookingDto>;
  finalizeBooking(
    input: {
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
    },
    client?: BookingDbClient,
  ): Promise<ProviderBookingDto>;
  findConfirmIdempotency(
    customerId: string,
    key: string,
  ): Promise<BookingConfirmIdempotencyRecord | null>;
  saveConfirmIdempotency(
    input: {
      customerId: string;
      key: string;
      requestHash: string;
      deliveryId: string;
      responsePayload: BookingConfirmResponsePayload;
    },
    client?: BookingDbClient,
  ): Promise<void>;
}

export class PrismaBookingRepository implements IBookingRepository {
  private db(client?: BookingDbClient) {
    return client ?? getPrismaClient();
  }

  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return getPrismaClient().$transaction(fn);
  }

  async getNextAttemptNumber(deliveryId: string): Promise<number> {
    const latest = await getPrismaClient().providerBooking.findFirst({
      where: { deliveryId },
      orderBy: { attemptNumber: "desc" },
      select: { attemptNumber: true },
    });
    return (latest?.attemptNumber ?? 0) + 1;
  }

  async findActiveByDeliveryId(
    deliveryId: string,
  ): Promise<ProviderBookingDto | null> {
    const row = await getPrismaClient().providerBooking.findFirst({
      where: {
        deliveryId,
        status: { in: ["PENDING", "BOOKING"] },
      },
      orderBy: { attemptNumber: "desc" },
    });
    return row ? mapBooking(row) : null;
  }

  async findLatestBookedByDeliveryId(
    deliveryId: string,
  ): Promise<ProviderBookingDto | null> {
    const row = await getPrismaClient().providerBooking.findFirst({
      where: { deliveryId, status: "BOOKED" },
      orderBy: { attemptNumber: "desc" },
    });
    return row ? mapBooking(row) : null;
  }

  async findLatestByDeliveryId(
    deliveryId: string,
  ): Promise<ProviderBookingDto | null> {
    const row = await getPrismaClient().providerBooking.findFirst({
      where: { deliveryId },
      orderBy: { attemptNumber: "desc" },
    });
    return row ? mapBooking(row) : null;
  }

  async findById(bookingId: string): Promise<ProviderBookingDto | null> {
    const row = await getPrismaClient().providerBooking.findUnique({
      where: { id: bookingId },
    });
    return row ? mapBooking(row) : null;
  }

  async createBookingAttempt(
    input: {
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
    },
    client?: BookingDbClient,
  ): Promise<ProviderBookingDto> {
    const row = await this.db(client).providerBooking.create({
      data: {
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
        quotedAmount: toDecimal(input.quotedAmount),
        quotedCurrency: input.quotedCurrency,
        providerQuoteId: input.providerQuoteId,
        quoteSnapshot: input.quoteSnapshot as unknown as Prisma.InputJsonValue,
        requestId: input.requestId,
      },
    });
    return mapBooking(row);
  }

  async finalizeBooking(
    input: {
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
    },
    client?: BookingDbClient,
  ): Promise<ProviderBookingDto> {
    const row = await this.db(client).providerBooking.update({
      where: { id: input.bookingId },
      data: {
        status: input.status,
        providerOrderId: input.providerOrderId,
        providerReference: input.providerReference,
        providerStatus: input.providerStatus,
        bookedAmount: toDecimal(input.bookedAmount ?? null),
        bookedCurrency: input.bookedCurrency,
        quotedAmount:
          input.quotedAmount !== undefined
            ? toDecimal(input.quotedAmount)
            : undefined,
        quotedCurrency: input.quotedCurrency,
        providerQuoteId: input.providerQuoteId,
        quoteSnapshot: input.quoteSnapshot
          ? (input.quoteSnapshot as unknown as Prisma.InputJsonValue)
          : undefined,
        unknownOutcome: input.unknownOutcome,
        failureCode: input.failureCode,
        failureMessage: input.failureMessage,
        bookedAt: input.bookedAt,
        failedAt: input.failedAt,
      },
    });
    return mapBooking(row);
  }

  async findConfirmIdempotency(
    customerId: string,
    key: string,
  ): Promise<BookingConfirmIdempotencyRecord | null> {
    const row = await getPrismaClient().bookingConfirmIdempotencyKey.findUnique({
      where: { customerId_key: { customerId, key } },
    });
    if (!row) return null;
    return {
      customerId: row.customerId,
      key: row.key,
      requestHash: row.requestHash,
      deliveryId: row.deliveryId,
      responsePayload: row.responsePayload as BookingConfirmResponsePayload,
    };
  }

  async saveConfirmIdempotency(
    input: {
      customerId: string;
      key: string;
      requestHash: string;
      deliveryId: string;
      responsePayload: BookingConfirmResponsePayload;
    },
    client?: BookingDbClient,
  ): Promise<void> {
    await this.db(client).bookingConfirmIdempotencyKey.create({
      data: {
        customerId: input.customerId,
        key: input.key,
        requestHash: input.requestHash,
        deliveryId: input.deliveryId,
        responsePayload: input.responsePayload as unknown as Prisma.InputJsonValue,
      },
    });
  }
}

export const bookingRepository = new PrismaBookingRepository();
