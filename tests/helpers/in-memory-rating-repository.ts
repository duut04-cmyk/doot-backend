import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { AppError } from "../../src/core/errors/app-error.js";
import { ErrorCodes } from "../../src/core/errors/error-codes.js";
import type { IRatingRepository } from "../../src/modules/rating/rating.repository.js";
import type {
  CreateExperienceRatingInput,
  DeliveryRatingDto,
} from "../../src/modules/rating/rating.types.js";
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

  private assertDelivered(input: { deliveryId: string; customerId: string }) {
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
    this.assertDelivered(input);

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
      platformRating: null,
      deliveryRating: input.deliveryRating,
      timelinessRating: null,
      packageHandlingRating: null,
      servicePresentationRating: null,
      createdAt: now,
      updatedAt: now,
    };
    this.ratings.push(row);
    return row;
  }

  async createExperienceForDeliveredDelivery(
    input: CreateExperienceRatingInput,
    _client?: Prisma.TransactionClient,
  ): Promise<DeliveryRatingDto> {
    this.assertDelivered(input);

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
      platformRating: input.platformRating,
      deliveryRating: input.deliveryRating,
      timelinessRating: input.timelinessRating,
      packageHandlingRating: input.packageHandlingRating,
      servicePresentationRating: input.servicePresentationRating,
      createdAt: now,
      updatedAt: now,
    };
    this.ratings.push(row);
    return row;
  }
}
