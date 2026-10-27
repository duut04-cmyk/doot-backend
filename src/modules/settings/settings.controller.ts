import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import { settingsService, type SettingsService } from "./settings.service.js";

function requireUser(req: Request) {
  if (!req.user) {
    throw new AppError("Authentication required.", {
      statusCode: 401,
      code: ErrorCodes.UNAUTHORIZED,
    });
  }
  return req.user;
}

function requireRequestId(req: Request): string {
  if (!req.requestId) {
    throw new AppError("Request id is required.", {
      statusCode: 500,
      code: ErrorCodes.INTERNAL_ERROR,
    });
  }
  return req.requestId;
}

export class SettingsController {
  constructor(private readonly service: SettingsService = settingsService) {}

  getSnapshot = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      requireUser(req);
      const result = await this.service.getSnapshot();
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  patchBookingPolicies = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = requireUser(req);
      const result = await this.service.patchBookingPolicies({
        adminUserId: user.id,
        requestId: requireRequestId(req),
        body: req.body,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const settingsController = new SettingsController();
