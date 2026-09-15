import type { UserRole } from "@prisma/client";
import { logger } from "../../config/logger.js";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import { loadAuthorizedDelivery } from "../delivery/delivery-access.js";
import {
  deliveryRepository,
  type IDeliveryRepository,
} from "../delivery/delivery.repository.js";
import { toRatingResponse } from "./rating.mapper.js";
import { ratingRepository, type IRatingRepository } from "./rating.repository.js";
import type { SubmitRatingBody } from "./rating.schema.js";

export class RatingService {
  constructor(
    private readonly deliveryRepo: IDeliveryRepository = deliveryRepository,
    private readonly ratingRepo: IRatingRepository = ratingRepository,
  ) {}

  async submitRating(input: {
    deliveryId: string;
    userId: string;
    role: UserRole;
    body: SubmitRatingBody;
    requestId?: string;
  }) {
    if (input.role !== "CUSTOMER") {
      throw new AppError("Only customers can submit ratings.", {
        statusCode: 403,
        code: ErrorCodes.FORBIDDEN,
      });
    }

    const delivery = await loadAuthorizedDelivery(
      this.deliveryRepo,
      input.deliveryId,
      input.userId,
      input.role,
    );
    if (delivery.status !== "DELIVERED") {
      throw new AppError("Rating is not allowed for this delivery.", {
        statusCode: 409,
        code: ErrorCodes.RATING_NOT_ALLOWED,
      });
    }

    const rating = await this.ratingRepo.withTransaction((tx) =>
      this.ratingRepo.createForDeliveredDelivery(
        {
          deliveryId: input.deliveryId,
          customerId: input.userId,
          driverRating: input.body.driverRating,
          deliveryRating: input.body.deliveryRating,
        },
        tx,
      ),
    );

    logger.info(
      {
        deliveryId: input.deliveryId,
        ratingId: rating.id,
        requestId: input.requestId,
      },
      "rating_submitted",
    );

    return { success: true as const, data: toRatingResponse(rating) };
  }

  async getRating(input: {
    deliveryId: string;
    userId: string;
    role: UserRole;
  }) {
    await loadAuthorizedDelivery(
      this.deliveryRepo,
      input.deliveryId,
      input.userId,
      input.role,
    );

    const rating = await this.ratingRepo.findByDeliveryId(input.deliveryId);
    if (!rating) {
      throw new AppError("Rating not found.", {
        statusCode: 404,
        code: ErrorCodes.RATING_NOT_FOUND,
      });
    }

    return { success: true as const, data: toRatingResponse(rating) };
  }
}

export const ratingService = new RatingService();
