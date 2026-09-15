import type { DeliveryOtpType, Prisma } from "@prisma/client";
import { getPrismaClient } from "../../config/database.js";

export type DeliveryOtpDto = {
  id: string;
  deliveryId: string;
  type: DeliveryOtpType;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  maxAttempts: number;
  consumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type OtpDbClient =
  | Prisma.TransactionClient
  | ReturnType<typeof getPrismaClient>;

function mapRow(row: {
  id: string;
  deliveryId: string;
  type: DeliveryOtpType;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  maxAttempts: number;
  consumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): DeliveryOtpDto {
  return { ...row };
}

export interface IOtpRepository {
  listByDeliveryId(deliveryId: string): Promise<DeliveryOtpDto[]>;
  findActive(
    deliveryId: string,
    type: DeliveryOtpType,
  ): Promise<DeliveryOtpDto | null>;
  create(
    input: {
      deliveryId: string;
      type: DeliveryOtpType;
      codeHash: string;
      expiresAt: Date;
      maxAttempts: number;
    },
    client?: OtpDbClient,
  ): Promise<DeliveryOtpDto>;
  incrementAttempts(id: string, client?: OtpDbClient): Promise<DeliveryOtpDto>;
  consume(id: string, client?: OtpDbClient): Promise<DeliveryOtpDto | null>;
  invalidateActive(deliveryId: string, type: DeliveryOtpType): Promise<void>;
}

export class PrismaOtpRepository implements IOtpRepository {
  private db(client?: OtpDbClient) {
    return client ?? getPrismaClient();
  }

  async listByDeliveryId(deliveryId: string): Promise<DeliveryOtpDto[]> {
    const rows = await getPrismaClient().deliveryOtp.findMany({
      where: { deliveryId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(mapRow);
  }

  async findActive(
    deliveryId: string,
    type: DeliveryOtpType,
  ): Promise<DeliveryOtpDto | null> {
    const row = await getPrismaClient().deliveryOtp.findFirst({
      where: { deliveryId, type, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return row ? mapRow(row) : null;
  }

  async create(
    input: {
      deliveryId: string;
      type: DeliveryOtpType;
      codeHash: string;
      expiresAt: Date;
      maxAttempts: number;
    },
    client?: OtpDbClient,
  ): Promise<DeliveryOtpDto> {
    const row = await this.db(client).deliveryOtp.create({ data: input });
    return mapRow(row);
  }

  async incrementAttempts(
    id: string,
    client?: OtpDbClient,
  ): Promise<DeliveryOtpDto> {
    const row = await this.db(client).deliveryOtp.update({
      where: { id },
      data: { attempts: { increment: 1 } },
    });
    return mapRow(row);
  }

  async consume(id: string, client?: OtpDbClient): Promise<DeliveryOtpDto | null> {
    const db = this.db(client);
    const consumedAt = new Date();
    const updated = await db.deliveryOtp.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt, updatedAt: consumedAt },
    });
    if (updated.count === 0) {
      return null;
    }
    const row = await db.deliveryOtp.findUnique({ where: { id } });
    return row ? mapRow(row) : null;
  }

  async invalidateActive(
    deliveryId: string,
    type: DeliveryOtpType,
  ): Promise<void> {
    await getPrismaClient().deliveryOtp.updateMany({
      where: { deliveryId, type, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  }
}

export const otpRepository = new PrismaOtpRepository();
