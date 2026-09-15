import type { UserRole } from "@prisma/client";
import { logger } from "../../config/logger.js";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import { loadAuthorizedDelivery } from "../delivery/delivery-access.js";
import {
  deliveryRepository,
  type IDeliveryRepository,
} from "../delivery/delivery.repository.js";
import { toFeedbackResponse } from "./feedback.mapper.js";
import {
  feedbackRepository,
  type IFeedbackRepository,
} from "./feedback.repository.js";
import type { SubmitFeedbackBody } from "./feedback.schema.js";

export class FeedbackService {
  constructor(
    private readonly deliveryRepo: IDeliveryRepository = deliveryRepository,
    private readonly feedbackRepo: IFeedbackRepository = feedbackRepository,
  ) {}

  async submitFeedback(input: {
    deliveryId: string;
    userId: string;
    role: UserRole;
    body: SubmitFeedbackBody;
    requestId?: string;
  }) {
    if (input.role !== "CUSTOMER") {
      throw new AppError("Only customers can submit feedback.", {
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
      throw new AppError("Feedback is not allowed for this delivery.", {
        statusCode: 409,
        code: ErrorCodes.FEEDBACK_NOT_ALLOWED,
      });
    }

    const feedback = await this.feedbackRepo.withTransaction((tx) =>
      this.feedbackRepo.createForDeliveredDelivery(
        {
          deliveryId: input.deliveryId,
          customerId: input.userId,
          positiveTags: input.body.positiveTags,
          issueTags: input.body.issueTags,
          comment: input.body.comment,
        },
        tx,
      ),
    );

    logger.info(
      {
        deliveryId: input.deliveryId,
        feedbackId: feedback.id,
        requestId: input.requestId,
      },
      "feedback_submitted",
    );

    return { success: true as const, data: toFeedbackResponse(feedback) };
  }

  async getFeedback(input: {
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

    const feedback = await this.feedbackRepo.findByDeliveryId(input.deliveryId);
    if (!feedback) {
      throw new AppError("Feedback not found.", {
        statusCode: 404,
        code: ErrorCodes.FEEDBACK_NOT_FOUND,
      });
    }

    return { success: true as const, data: toFeedbackResponse(feedback) };
  }
}

export const feedbackService = new FeedbackService();
