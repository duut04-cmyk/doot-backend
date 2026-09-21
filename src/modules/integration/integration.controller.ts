import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import { integrationService, type IntegrationService } from "./integration.service.js";

function requireUser(req: Request) {
  if (!req.user) {
    throw new AppError("Authentication required.", {
      statusCode: 401,
      code: ErrorCodes.UNAUTHORIZED,
    });
  }
  return req.user;
}

export class IntegrationController {
  constructor(private readonly service: IntegrationService = integrationService) {}

  getStatus = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      requireUser(req);
      const result = await this.service.getStatus();
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const integrationController = new IntegrationController();
