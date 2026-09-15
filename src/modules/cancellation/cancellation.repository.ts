import type { CancellationStatus, Prisma } from "@prisma/client";
import { getPrismaClient } from "../../config/database.js";

export type DeliveryCancellationDto = {
  id: string;
  deliveryId: string;
  providerBookingId: string | null;
  providerId: string | null;
  reasonCode: string;
  reasonMessage: string | null;
  status: CancellationStatus;
  correlationReference: string;
  providerCancellationReference: string | null;
  cancelledAt: Date | null;
  requestedAt: Date;
  failureCode: string | null;
  failureMessage: string | null;
  requestId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CancellationResponsePayload = {
  delivery: { id: string; reference: string; status: string };
  cancellation: {
    id: string;
    status: CancellationStatus;
    reasonCode: string;
    cancelledAt: string | null;
  };
};

function mapRow(row: {
  id: string;
  deliveryId: string;
  providerBookingId: string | null;
  providerId: string | null;
  reasonCode: string;
  reasonMessage: string | null;
  status: CancellationStatus;
  correlationReference: string;
  providerCancellationReference: string | null;
  cancelledAt: Date | null;
  requestedAt: Date;
  failureCode: string | null;
  failureMessage: string | null;
  requestId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): DeliveryCancellationDto {
  return { ...row };
}

export interface ICancellationRepository {
  getNextAttemptNumber(deliveryId: string): Promise<number>;
  findLatestByDeliveryId(
    deliveryId: string,
  ): Promise<DeliveryCancellationDto | null>;
  findProcessingByDeliveryId(
    deliveryId: string,
  ): Promise<DeliveryCancellationDto | null>;
  create(
    input: {
      deliveryId: string;
      providerBookingId: string | null;
      providerId: string | null;
      reasonCode: string;
      reasonMessage: string | null;
      status: CancellationStatus;
      correlationReference: string;
      requestId: string;
    },
    client?: Prisma.TransactionClient,
  ): Promise<DeliveryCancellationDto>;
  finalize(
    input: {
      cancellationId: string;
      status: CancellationStatus;
      providerCancellationReference?: string | null;
      cancelledAt?: Date | null;
      failureCode?: string | null;
      failureMessage?: string | null;
    },
    client?: Prisma.TransactionClient,
  ): Promise<DeliveryCancellationDto>;
  findIdempotency(
    customerId: string,
    key: string,
  ): Promise<{
    customerId: string;
    key: string;
    requestHash: string;
    deliveryId: string;
    responsePayload: CancellationResponsePayload;
  } | null>;
  saveIdempotency(
    input: {
      customerId: string;
      key: string;
      requestHash: string;
      deliveryId: string;
      responsePayload: CancellationResponsePayload;
    },
    client?: Prisma.TransactionClient,
  ): Promise<void>;
}

export class PrismaCancellationRepository implements ICancellationRepository {
  private db(client?: Prisma.TransactionClient) {
    return client ?? getPrismaClient();
  }

  async getNextAttemptNumber(deliveryId: string): Promise<number> {
    const latest = await getPrismaClient().deliveryCancellation.findFirst({
      where: { deliveryId },
      orderBy: { createdAt: "desc" },
      select: { correlationReference: true },
    });
    if (!latest) return 1;
    const match = /-CANCEL-(\d+)$/.exec(latest.correlationReference);
    return match ? Number(match[1]) + 1 : 1;
  }

  async findLatestByDeliveryId(
    deliveryId: string,
  ): Promise<DeliveryCancellationDto | null> {
    const row = await getPrismaClient().deliveryCancellation.findFirst({
      where: { deliveryId },
      orderBy: { createdAt: "desc" },
    });
    return row ? mapRow(row) : null;
  }

  async findProcessingByDeliveryId(
    deliveryId: string,
  ): Promise<DeliveryCancellationDto | null> {
    const row = await getPrismaClient().deliveryCancellation.findFirst({
      where: { deliveryId, status: "PROCESSING" },
    });
    return row ? mapRow(row) : null;
  }

  async create(
    input: {
      deliveryId: string;
      providerBookingId: string | null;
      providerId: string | null;
      reasonCode: string;
      reasonMessage: string | null;
      status: CancellationStatus;
      correlationReference: string;
      requestId: string;
    },
    client?: Prisma.TransactionClient,
  ): Promise<DeliveryCancellationDto> {
    const row = await this.db(client).deliveryCancellation.create({ data: input });
    return mapRow(row);
  }

  async finalize(
    input: {
      cancellationId: string;
      status: CancellationStatus;
      providerCancellationReference?: string | null;
      cancelledAt?: Date | null;
      failureCode?: string | null;
      failureMessage?: string | null;
    },
    client?: Prisma.TransactionClient,
  ): Promise<DeliveryCancellationDto> {
    const row = await this.db(client).deliveryCancellation.update({
      where: { id: input.cancellationId },
      data: {
        status: input.status,
        providerCancellationReference: input.providerCancellationReference,
        cancelledAt: input.cancelledAt,
        failureCode: input.failureCode,
        failureMessage: input.failureMessage,
      },
    });
    return mapRow(row);
  }

  async findIdempotency(customerId: string, key: string) {
    const row = await getPrismaClient().cancellationIdempotencyKey.findUnique({
      where: { customerId_key: { customerId, key } },
    });
    if (!row) return null;
    return {
      customerId: row.customerId,
      key: row.key,
      requestHash: row.requestHash,
      deliveryId: row.deliveryId,
      responsePayload: row.responsePayload as CancellationResponsePayload,
    };
  }

  async saveIdempotency(
    input: {
      customerId: string;
      key: string;
      requestHash: string;
      deliveryId: string;
      responsePayload: CancellationResponsePayload;
    },
    client?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.db(client).cancellationIdempotencyKey.create({
      data: {
        ...input,
        responsePayload: input.responsePayload as Prisma.InputJsonValue,
      },
    });
  }
}

export const cancellationRepository = new PrismaCancellationRepository();
