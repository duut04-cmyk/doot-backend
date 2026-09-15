import { randomUUID } from "node:crypto";
import type { CancellationStatus, Prisma } from "@prisma/client";
import type {
  CancellationResponsePayload,
  DeliveryCancellationDto,
  ICancellationRepository,
} from "../../src/modules/cancellation/cancellation.repository.js";

export class InMemoryCancellationRepository implements ICancellationRepository {
  cancellations: DeliveryCancellationDto[] = [];
  idempotency: Array<{
    customerId: string;
    key: string;
    requestHash: string;
    deliveryId: string;
    responsePayload: CancellationResponsePayload;
  }> = [];

  async getNextAttemptNumber(deliveryId: string): Promise<number> {
    const latest = this.cancellations
      .filter((item) => item.deliveryId === deliveryId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (!latest) return 1;
    const match = /-CANCEL-(\d+)$/.exec(latest.correlationReference);
    return match ? Number(match[1]) + 1 : 1;
  }

  async findLatestByDeliveryId(
    deliveryId: string,
  ): Promise<DeliveryCancellationDto | null> {
    return (
      this.cancellations
        .filter((item) => item.deliveryId === deliveryId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
    );
  }

  async findProcessingByDeliveryId(
    deliveryId: string,
  ): Promise<DeliveryCancellationDto | null> {
    return (
      this.cancellations.find(
        (item) => item.deliveryId === deliveryId && item.status === "PROCESSING",
      ) ?? null
    );
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
    _client?: Prisma.TransactionClient,
  ): Promise<DeliveryCancellationDto> {
    const now = new Date();
    const row: DeliveryCancellationDto = {
      id: randomUUID(),
      ...input,
      providerCancellationReference: null,
      cancelledAt: null,
      requestedAt: now,
      failureCode: null,
      failureMessage: null,
      createdAt: now,
      updatedAt: now,
    };
    this.cancellations.push(row);
    return row;
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
    _client?: Prisma.TransactionClient,
  ): Promise<DeliveryCancellationDto> {
    const row = this.cancellations.find((item) => item.id === input.cancellationId);
    if (!row) {
      throw new Error("Cancellation not found.");
    }
    row.status = input.status;
    row.providerCancellationReference =
      input.providerCancellationReference ?? row.providerCancellationReference;
    row.cancelledAt = input.cancelledAt ?? row.cancelledAt;
    row.failureCode = input.failureCode ?? row.failureCode;
    row.failureMessage = input.failureMessage ?? row.failureMessage;
    row.updatedAt = new Date();
    return row;
  }

  async findIdempotency(customerId: string, key: string) {
    return (
      this.idempotency.find(
        (item) => item.customerId === customerId && item.key === key,
      ) ?? null
    );
  }

  async saveIdempotency(
    input: {
      customerId: string;
      key: string;
      requestHash: string;
      deliveryId: string;
      responsePayload: CancellationResponsePayload;
    },
    _client?: Prisma.TransactionClient,
  ): Promise<void> {
    this.idempotency.push({ ...input });
  }
}
