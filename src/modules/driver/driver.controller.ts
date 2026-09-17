import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import type { ConfirmDeliveryParams } from "../booking/booking.schema.js";
import type { NormalizedDriver } from "../provider/contracts/common.js";
import { driverService, type DriverService } from "./driver.service.js";

function requireUser(req: Request) {
  if (!req.user) {
    throw new AppError("Authentication required.", {
      statusCode: 401,
      code: ErrorCodes.UNAUTHORIZED,
    });
  }
  return req.user;
}

export class DriverController {
  constructor(private readonly service: DriverService = driverService) {}

  getDriver = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = requireUser(req);
      const params = req.params as unknown as ConfirmDeliveryParams;
      const result = await this.service.getDriver({
        deliveryId: params.id,
        userId: user.id,
        role: user.role,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  refreshFromProvider = async (
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

  simulateProviderAssignment = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = requireUser(req);
      const params = req.params as unknown as ConfirmDeliveryParams;
      const driver = req.body as NormalizedDriver;
      const result = await this.service.simulateProviderAssignment({
        deliveryId: params.id,
        userId: user.id,
        role: user.role,
        driver,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const driverController = new DriverController();
