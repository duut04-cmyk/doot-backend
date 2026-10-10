import type { UserRole } from "@prisma/client";
import { logger } from "../../config/logger.js";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import { loadAuthorizedDelivery } from "../delivery/delivery-access.js";
import {
  deliveryRepository,
  type IDeliveryRepository,
} from "../delivery/delivery.repository.js";
import { toFeedbackResponse } from "../feedback/feedback.mapper.js";
import {
  feedbackRepository,
  type IFeedbackRepository,
} from "../feedback/feedback.repository.js";
import { toRatingResponse } from "../rating/rating.mapper.js";
import {
  ratingRepository,
  type IRatingRepository,
} from "../rating/rating.repository.js";
import { deriveFeedbackTagsFromExperienceScores } from "./derive-feedback-tags.js";
import type { SubmitDeliveryExperienceBody } from "./experience.schema.js";
import type { SubmitDeliveryExperienceResult } from "./experience.types.js";

export class ExperienceService {
  constructor(
    private readonly deliveryRepo: IDeliveryRepository = deliveryRepository,
    private readonly ratingRepo: IRatingRepository = ratingRepository,
    private readonly feedbackRepo: IFeedbackRepository = feedbackRepository,
  ) {}

  async submitExperience(input: {
    deliveryId: string;
    userId: string;
    role: UserRole;
    body: SubmitDeliveryExperienceBody;
    requestId?: string;
  }): Promise<SubmitDeliveryExperienceResult> {
    if (input.role !== "CUSTOMER") {
      throw new AppError("Only customers can submit delivery experience.", {
        statusCode: 403,
        code: ErrorCodes.FORBIDDEN,
      });
    }

    await loadAuthorizedDelivery(
      this.deliveryRepo,
      input.deliveryId,
      input.userId,
      input.role,
    );

    const existingRating = await this.ratingRepo.findByDeliveryId(input.deliveryId);
    if (existingRating) {
      throw new AppError("A rating has already been submitted for this delivery.", {
        statusCode: 409,
        code: ErrorCodes.RATING_ALREADY_SUBMITTED,
      });
    }

    const existingFeedback = await this.feedbackRepo.findByDeliveryId(input.deliveryId);
    if (existingFeedback) {
      throw new AppError("Feedback has already been submitted for this delivery.", {
        statusCode: 409,
        code: ErrorCodes.FEEDBACK_ALREADY_SUBMITTED,
      });
    }

    const { positiveTags, issueTags } = deriveFeedbackTagsFromExperienceScores({
      driverRating: input.body.driverRating,
      platformRating: input.body.platformRating,
      deliveryRating: input.body.deliveryRating,
      timelinessRating: input.body.timelinessRating,
      packageHandlingRating: input.body.packageHandlingRating,
      servicePresentationRating: input.body.servicePresentationRating,
    });

    const result = await this.ratingRepo.withTransaction(async (tx) => {
      const rating = await this.ratingRepo.createExperienceForDeliveredDelivery(
        {
          deliveryId: input.deliveryId,
          customerId: input.userId,
          driverRating: input.body.driverRating,
          platformRating: input.body.platformRating,
          deliveryRating: input.body.deliveryRating,
          timelinessRating: input.body.timelinessRating,
          packageHandlingRating: input.body.packageHandlingRating,
          servicePresentationRating: input.body.servicePresentationRating,
        },
        tx,
      );

      const feedback = await this.feedbackRepo.createForDeliveredDelivery(
        {
          deliveryId: input.deliveryId,
          customerId: input.userId,
          positiveTags,
          issueTags,
          comment: input.body.comment ?? null,
        },
        tx,
      );

      return { rating, feedback };
    });

    logger.info(
      {
        deliveryId: input.deliveryId,
        ratingId: result.rating.id,
        feedbackId: result.feedback.id,
        requestId: input.requestId,
      },
      "delivery_experience_submitted",
    );

    const feedbackResponse = toFeedbackResponse(result.feedback);

    return {
      success: true,
      data: {
        rating: toRatingResponse(result.rating),
        feedback: {
          positiveTags: feedbackResponse.positiveTags,
          issueTags: feedbackResponse.issueTags,
          comment: feedbackResponse.comment,
          submittedAt: feedbackResponse.createdAt,
        },
      },
    };
  }
}

export const experienceService = new ExperienceService();
