import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import {
  IDEMPOTENCY_HEADER,
  MAX_IDEMPOTENCY_KEY_LENGTH,
} from "../delivery/delivery.constants.js";
import {
  hashPaymentCreateRequest,
  type PaymentDeliveryParams,
} from "./payment.schema.js";
import { paymentService, type PaymentService } from "./payment.service.js";

function requireUser(req: Request) {
  if (!req.user) {
    throw new AppError("Authentication required.", {
      statusCode: 401,
      code: ErrorCodes.UNAUTHORIZED,
    });
  }
  return req.user;
}

function readOptionalIdempotencyKey(req: Request): string | undefined {
  const raw = req.header(IDEMPOTENCY_HEADER)?.trim();
  if (!raw) {
    return undefined;
  }
  if (raw.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new AppError("Idempotency-Key is too long.", {
      statusCode: 400,
      code: ErrorCodes.VALIDATION_ERROR,
    });
  }
  return raw;
}

export class PaymentController {
  constructor(private readonly service: PaymentService = paymentService) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = requireUser(req);
      const params = req.params as unknown as PaymentDeliveryParams;
      const result = await this.service.createPaymentForDelivery({
        deliveryId: params.id,
        userId: user.id,
        role: user.role,
        requestId: req.requestId,
        idempotencyKey: readOptionalIdempotencyKey(req),
        requestHash: hashPaymentCreateRequest(),
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = requireUser(req);
      const params = req.params as unknown as PaymentDeliveryParams;
      const result = await this.service.getPaymentForDelivery({
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

export const paymentController = new PaymentController();
