import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { AppError } from "../../src/core/errors/app-error.js";
import { ErrorCodes } from "../../src/core/errors/error-codes.js";
import type { IRatingRepository } from "../../src/modules/rating/rating.repository.js";
import type { DeliveryRatingDto } from "../../src/modules/rating/rating.types.js";
import type { InMemoryDeliveryRepository } from "./in-memory-delivery-repository.js";

export class InMemoryRatingRepository implements IRatingRepository {
  ratings: DeliveryRatingDto[] = [];

  constructor(private readonly deliveryRepo: InMemoryDeliveryRepository) {}

  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return fn({} as Prisma.TransactionClient);
  }

  async findByDeliveryId(deliveryId: string): Promise<DeliveryRatingDto | null> {
    return this.ratings.find((item) => item.deliveryId === deliveryId) ?? null;
  }

  async createForDeliveredDelivery(
    input: {
      deliveryId: string;
      customerId: string;
      driverRating: number;
      deliveryRating: number;
    },
    _client?: Prisma.TransactionClient,
  ): Promise<DeliveryRatingDto> {
    const delivery = this.deliveryRepo.deliveries.find(
      (item) =>
        item.id === input.deliveryId &&
        item.customerId === input.customerId &&
        item.status === "DELIVERED",
    );
    if (!delivery) {
      throw new AppError("Rating is not allowed for this delivery.", {
        statusCode: 409,
        code: ErrorCodes.RATING_NOT_ALLOWED,
      });
    }

    if (this.ratings.some((item) => item.deliveryId === input.deliveryId)) {
      throw new AppError("A rating has already been submitted for this delivery.", {
        statusCode: 409,
        code: ErrorCodes.RATING_ALREADY_SUBMITTED,
      });
    }

    const now = new Date();
    const row: DeliveryRatingDto = {
      id: randomUUID(),
      deliveryId: input.deliveryId,
      driverRating: input.driverRating,
      deliveryRating: input.deliveryRating,
      createdAt: now,
      updatedAt: now,
    };
    this.ratings.push(row);
    return row;
  }
}
