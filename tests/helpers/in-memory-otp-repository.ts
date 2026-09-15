import { randomUUID } from "node:crypto";
import type { DeliveryOtpType, Prisma } from "@prisma/client";
import type {
  DeliveryOtpDto,
  IOtpRepository,
} from "../../src/modules/otp/otp.repository.js";

export class InMemoryOtpRepository implements IOtpRepository {
  otps: DeliveryOtpDto[] = [];

  async listByDeliveryId(deliveryId: string): Promise<DeliveryOtpDto[]> {
    return this.otps
      .filter((item) => item.deliveryId === deliveryId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findActive(
    deliveryId: string,
    type: DeliveryOtpType,
  ): Promise<DeliveryOtpDto | null> {
    return (
      this.otps
        .filter(
          (item) =>
            item.deliveryId === deliveryId &&
            item.type === type &&
            item.consumedAt == null,
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
    );
  }

  async create(
    input: {
      deliveryId: string;
      type: DeliveryOtpType;
      codeHash: string;
      expiresAt: Date;
      maxAttempts: number;
    },
    _client?: Prisma.TransactionClient,
  ): Promise<DeliveryOtpDto> {
    const now = new Date();
    const row: DeliveryOtpDto = {
      id: randomUUID(),
      ...input,
      attempts: 0,
      consumedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.otps.push(row);
    return row;
  }

  async incrementAttempts(
    id: string,
    _client?: Prisma.TransactionClient,
  ): Promise<DeliveryOtpDto> {
    const row = this.otps.find((item) => item.id === id);
    if (!row) {
      throw new Error("OTP not found.");
    }
    row.attempts += 1;
    row.updatedAt = new Date();
    return row;
  }

  async consume(
    id: string,
    _client?: Prisma.TransactionClient,
  ): Promise<DeliveryOtpDto | null> {
    const row = this.otps.find((item) => item.id === id);
    if (!row || row.consumedAt != null) {
      return null;
    }
    row.consumedAt = new Date();
    row.updatedAt = new Date();
    return row;
  }

  async invalidateActive(deliveryId: string, type: DeliveryOtpType): Promise<void> {
    const now = new Date();
    for (const row of this.otps) {
      if (
        row.deliveryId === deliveryId &&
        row.type === type &&
        row.consumedAt == null
      ) {
        row.consumedAt = now;
        row.updatedAt = now;
      }
    }
  }
}
