import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import type { OrchestrationDeliveryParams } from "./orchestration.schema.js";
import {
  orchestrationService,
  type OrchestrationService,
} from "./orchestration.service.js";

function requireUser(req: Request) {
  if (!req.user) {
    throw new AppError("Authentication required.", {
      statusCode: 401,
      code: ErrorCodes.UNAUTHORIZED,
    });
  }
  return req.user;
}

export class OrchestrationController {
  constructor(
    private readonly service: OrchestrationService = orchestrationService,
  ) {}

  orchestrate = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = requireUser(req);
      const params = req.params as unknown as OrchestrationDeliveryParams;
      const result = await this.service.orchestrate({
        deliveryId: params.id,
        userId: user.id,
        role: user.role,
        requestId: req.requestId,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  getLatest = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = requireUser(req);
      const params = req.params as unknown as OrchestrationDeliveryParams;
      const result = await this.service.getLatestOrchestration({
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

export const orchestrationController = new OrchestrationController();
