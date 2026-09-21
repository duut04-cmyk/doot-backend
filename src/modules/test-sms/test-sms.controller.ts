import type { NextFunction, Request, Response } from "express";
import { generateEmailVerificationOtp } from "../auth/auth.crypto.js";
import {
  msg91Service,
  type Msg91Service,
} from "../../infrastructure/sms/msg91.service.js";
import type { SmsTestType } from "./test-sms.schema.js";

export class TestSmsController {
  constructor(private readonly sms: Msg91Service = msg91Service) {}

  sendTestSms = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { phone, type } = req.body as {
        phone: string;
        type: SmsTestType;
      };
      const otp = generateEmailVerificationOtp();

      await this.sms.sendOtp({
        phone,
        type,
        otp,
        correlationId: req.requestId,
      });

      res.status(200).json({
        success: true,
        message: "Test SMS sent successfully",
      });
    } catch (error) {
      next(error);
    }
  };
}

export const testSmsController = new TestSmsController();
