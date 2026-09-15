import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import type { ConfirmDeliveryParams } from "../booking/booking.schema.js";
import type { VerifyOtpBody } from "./otp.schema.js";
import { otpService, type OtpService } from "./otp.service.js";

function requireUser(req: Request) {
  if (!req.user) {
    throw new AppError("Authentication required.", {
      statusCode: 401,
      code: ErrorCodes.UNAUTHORIZED,
    });
  }
  return req.user;
}

export class OtpController {
  constructor(private readonly service: OtpService = otpService) {}

  generatePickupOtp = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = requireUser(req);
      const params = req.params as unknown as ConfirmDeliveryParams;
      const result = await this.service.generatePickupOtp({
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

  verifyPickupOtp = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = requireUser(req);
      const params = req.params as unknown as ConfirmDeliveryParams;
      const body = req.body as VerifyOtpBody;
      const result = await this.service.verifyPickupOtp({
        deliveryId: params.id,
        userId: user.id,
        role: user.role,
        otp: body.otp,
        requestId: req.requestId,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  generateDeliveryOtp = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = requireUser(req);
      const params = req.params as unknown as ConfirmDeliveryParams;
      const result = await this.service.generateDeliveryOtp({
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

  verifyDeliveryOtp = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = requireUser(req);
      const params = req.params as unknown as ConfirmDeliveryParams;
      const body = req.body as VerifyOtpBody;
      const result = await this.service.verifyDeliveryOtp({
        deliveryId: params.id,
        userId: user.id,
        role: user.role,
        otp: body.otp,
        requestId: req.requestId,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const otpController = new OtpController();
