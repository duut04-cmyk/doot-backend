import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import {
  IDEMPOTENCY_HEADER,
  MAX_IDEMPOTENCY_KEY_LENGTH,
} from "./delivery.constants.js";
import type {
  CreateDeliveryBody,
  DeliveryIdParams,
  ListDeliveriesQuery,
} from "./delivery.schema.js";
import { hashDeliveryCreateRequest } from "./delivery.schema.js";
import {
  deliveryHistoryService,
  type DeliveryHistoryService,
} from "./delivery-history.service.js";
import { deliveryService, type DeliveryService } from "./delivery.service.js";

function requireUser(req: Request) {
  if (!req.user) {
    throw new AppError("Authentication required.", {
      statusCode: 401,
      code: ErrorCodes.UNAUTHORIZED,
    });
  }
  return req.user;
}

function readIdempotencyKey(req: Request): string {
  const raw = req.header(IDEMPOTENCY_HEADER)?.trim();
  if (!raw) {
    throw new AppError("Idempotency-Key header is required.", {
      statusCode: 400,
      code: ErrorCodes.IDEMPOTENCY_KEY_REQUIRED,
    });
  }
  if (raw.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new AppError("Idempotency-Key is too long.", {
      statusCode: 400,
      code: ErrorCodes.VALIDATION_ERROR,
    });
  }
  return raw;
}

export class DeliveryController {
  constructor(
    private readonly service: DeliveryService = deliveryService,
    private readonly historyService: DeliveryHistoryService = deliveryHistoryService,
  ) {}

  create = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = requireUser(req);
      const body = req.body as CreateDeliveryBody;
      const result = await this.service.createDelivery({
        customerId: user.id,
        body,
        idempotencyKey: readIdempotencyKey(req),
        requestHash: hashDeliveryCreateRequest(body),
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  list = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = requireUser(req);
      const query = req.query as unknown as ListDeliveriesQuery;
      const result = await this.service.listDeliveries({
        customerId: user.id,
        role: user.role,
        query,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  getById = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = requireUser(req);
      const params = req.params as unknown as DeliveryIdParams;
      const result = await this.service.getDelivery({
        deliveryId: params.id,
        customerId: user.id,
        role: user.role,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  getHistoryDetail = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = requireUser(req);
      const params = req.params as unknown as DeliveryIdParams;
      const result = await this.historyService.getHistoryDetail({
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

export const deliveryController = new DeliveryController();
