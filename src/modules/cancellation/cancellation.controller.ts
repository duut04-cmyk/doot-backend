import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import {
  IDEMPOTENCY_HEADER,
  MAX_IDEMPOTENCY_KEY_LENGTH,
} from "../delivery/delivery.constants.js";
import type { ConfirmDeliveryParams } from "../booking/booking.schema.js";
import type { CancelDeliveryBody } from "./cancellation.schema.js";
import { hashCancelRequest } from "./cancellation.schema.js";
import {
  cancellationService,
  type CancellationService,
} from "./cancellation.service.js";

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
  if (!raw) return undefined;
  if (raw.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new AppError("Idempotency-Key is too long.", {
      statusCode: 400,
      code: ErrorCodes.VALIDATION_ERROR,
    });
  }
  return raw;
}

export class CancellationController {
  constructor(
    private readonly service: CancellationService = cancellationService,
  ) {}

  cancel = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = requireUser(req);
      const params = req.params as unknown as ConfirmDeliveryParams;
      const body = req.body as CancelDeliveryBody;
      const result = await this.service.cancel({
        deliveryId: params.id,
        userId: user.id,
        role: user.role,
        requestId: req.requestId,
        reasonCode: body.reasonCode,
        reasonMessage: body.reasonMessage,
        idempotencyKey: readOptionalIdempotencyKey(req),
        requestHash: hashCancelRequest(body),
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  getCancellation = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = requireUser(req);
      const params = req.params as unknown as ConfirmDeliveryParams;
      const result = await this.service.getCancellation({
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

export const cancellationController = new CancellationController();
