import type { NextFunction, Request, Response } from "express";
import type {
  FinanceRangeQuery,
  FinanceReconciliationQuery,
  FinanceTimeseriesQuery,
  ListPaymentsQuery,
  ListRefundsQuery,
  PaymentIdParams,
} from "./admin-finance.schema.js";
import { parseFinanceRange } from "./admin-finance.schema.js";
import {
  adminFinanceService,
  type AdminFinanceService,
} from "./admin-finance.service.js";

export class AdminFinanceController {
  constructor(private readonly service: AdminFinanceService = adminFinanceService) {}

  listPayments = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = req.query as unknown as ListPaymentsQuery;
      const result = await this.service.listPayments(query);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  paymentSummary = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = req.query as unknown as FinanceRangeQuery;
      const window = parseFinanceRange(query);
      const result = await this.service.getSummary(window);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  getPaymentById = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const params = req.params as unknown as PaymentIdParams;
      const result = await this.service.getPaymentById(params.id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  listRefunds = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = req.query as unknown as ListRefundsQuery;
      const result = await this.service.listRefunds(query);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  timeseries = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = req.query as unknown as FinanceTimeseriesQuery;
      const window = parseFinanceRange(query);
      const result = await this.service.getTimeseries({
        window,
        granularity: query.granularity,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  reconciliation = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = req.query as unknown as FinanceReconciliationQuery;
      const window =
        query.from && query.to
          ? parseFinanceRange({ from: query.from, to: query.to })
          : null;
      const result = await this.service.getReconciliation({
        window,
        issueLimit: query.limit,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const adminFinanceController = new AdminFinanceController();
