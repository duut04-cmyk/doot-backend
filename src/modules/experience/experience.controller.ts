import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import type { DeliveryIdParams } from "../delivery/delivery.schema.js";
import type { SubmitDeliveryExperienceBody } from "./experience.schema.js";
import { experienceService, type ExperienceService } from "./experience.service.js";

function requireUser(req: Request) {
  if (!req.user) {
    throw new AppError("Authentication required.", {
      statusCode: 401,
      code: ErrorCodes.UNAUTHORIZED,
    });
  }
  return req.user;
}

export class ExperienceController {
  constructor(private readonly service: ExperienceService = experienceService) {}

  submit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = requireUser(req);
      const params = req.params as unknown as DeliveryIdParams;
      const body = req.body as SubmitDeliveryExperienceBody;
      const result = await this.service.submitExperience({
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
}

export const experienceController = new ExperienceController();
