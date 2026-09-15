import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import type { DeliveryIdParams } from "../delivery/delivery.schema.js";
import type { SubmitFeedbackBody } from "./feedback.schema.js";
import { feedbackService, type FeedbackService } from "./feedback.service.js";

function requireUser(req: Request) {
  if (!req.user) {
    throw new AppError("Authentication required.", {
      statusCode: 401,
      code: ErrorCodes.UNAUTHORIZED,
    });
  }
  return req.user;
}

export class FeedbackController {
  constructor(private readonly service: FeedbackService = feedbackService) {}

  submit = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = requireUser(req);
      const params = req.params as unknown as DeliveryIdParams;
      const body = req.body as SubmitFeedbackBody;
      const result = await this.service.submitFeedback({
        deliveryId: params.id,
        userId: user.id,
        role: user.role,
        body,
        requestId: req.requestId,
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  getFeedback = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = requireUser(req);
      const params = req.params as unknown as DeliveryIdParams;
      const result = await this.service.getFeedback({
        deliveryId: params.id,
        userId: user.id,
        role: user.role,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const feedbackController = new FeedbackController();
