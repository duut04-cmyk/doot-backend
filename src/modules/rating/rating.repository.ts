import type { Prisma } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";
import { getPrismaClient } from "../../config/database.js";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import type { DeliveryRatingDto } from "./rating.types.js";

export type RatingDbClient =
  | Prisma.TransactionClient
  | ReturnType<typeof getPrismaClient>;

function mapRow(row: {
  id: string;
  deliveryId: string;
  customerId: string;
  driverRating: number;
  deliveryRating: number;
  createdAt: Date;
  updatedAt: Date;
}): DeliveryRatingDto {
  return {
    id: row.id,
    deliveryId: row.deliveryId,
    driverRating: row.driverRating,
    deliveryRating: row.deliveryRating,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface IRatingRepository {
  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
  findByDeliveryId(deliveryId: string): Promise<DeliveryRatingDto | null>;
  createForDeliveredDelivery(
    input: {
      deliveryId: string;
      customerId: string;
      driverRating: number;
      deliveryRating: number;
    },
    client?: RatingDbClient,
  ): Promise<DeliveryRatingDto>;
}

export class PrismaRatingRepository implements IRatingRepository {
  private db(client?: RatingDbClient) {
    return client ?? getPrismaClient();
  }

  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return getPrismaClient().$transaction(fn);
  }

  async findByDeliveryId(deliveryId: string): Promise<DeliveryRatingDto | null> {
    const row = await getPrismaClient().deliveryRating.findUnique({
      where: { deliveryId },
    });
    return row ? mapRow(row) : null;
  }

  async createForDeliveredDelivery(
    input: {
      deliveryId: string;
      customerId: string;
      driverRating: number;
      deliveryRating: number;
    },
    client?: RatingDbClient,
  ): Promise<DeliveryRatingDto> {
    const db = this.db(client);
    const delivery = await db.delivery.findFirst({
      where: {
        id: input.deliveryId,
        customerId: input.customerId,
        status: "DELIVERED",
      },
      select: { id: true },
    });
    if (!delivery) {
      throw new AppError("Rating is not allowed for this delivery.", {
        statusCode: 409,
        code: ErrorCodes.RATING_NOT_ALLOWED,
      });
    }

    try {
      const row = await db.deliveryRating.create({
        data: {
          deliveryId: input.deliveryId,
          customerId: input.customerId,
          driverRating: input.driverRating,
          deliveryRating: input.deliveryRating,
        },
      });
      return mapRow(row);
    } catch (error) {
      if (
        error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new AppError("A rating has already been submitted for this delivery.", {
          statusCode: 409,
          code: ErrorCodes.RATING_ALREADY_SUBMITTED,
        });
      }
      throw error;
    }
  }
}

export const ratingRepository = new PrismaRatingRepository();
