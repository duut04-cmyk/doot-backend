import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import type { ConfirmDeliveryParams } from "../booking/booking.schema.js";
import { trackingService, type TrackingService } from "./tracking.service.js";

function requireUser(req: Request) {
  if (!req.user) {
    throw new AppError("Authentication required.", {
      statusCode: 401,
      code: ErrorCodes.UNAUTHORIZED,
    });
  }
  return req.user;
}

export class TrackingController {
  constructor(private readonly service: TrackingService = trackingService) {}

  getTracking = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = requireUser(req);
      const params = req.params as unknown as ConfirmDeliveryParams;
      const result = await this.service.getTracking({
        deliveryId: params.id,
        userId: user.id,
        role: user.role,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  getHistory = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = requireUser(req);
      const params = req.params as unknown as ConfirmDeliveryParams;
      const page = Number(req.query.page ?? 1);
      const limit = Number(req.query.limit ?? 20);
      const result = await this.service.getHistory({
        deliveryId: params.id,
        userId: user.id,
        role: user.role,
        page,
        limit,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  refresh = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = requireUser(req);
      const params = req.params as unknown as ConfirmDeliveryParams;
      const result = await this.service.refreshFromProvider({
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
}

export const trackingController = new TrackingController();
