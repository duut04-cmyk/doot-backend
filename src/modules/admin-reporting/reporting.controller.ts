import type { NextFunction, Request, Response } from "express";
import type {
  FeedbackReportingQuery,
  RecentActivityQuery,
  RecentDeliveriesQuery,
  ReportingRangeQuery,
} from "./reporting.schema.js";
import { parseReportingRange } from "./reporting.schema.js";
import { reportingService, type ReportingService } from "./reporting.service.js";

export class ReportingController {
  constructor(private readonly service: ReportingService = reportingService) {}

  summary = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as ReportingRangeQuery;
      const window = parseReportingRange(query);
      const result = await this.service.getSummary(window);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  orchestration = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = req.query as unknown as ReportingRangeQuery;
      const window = parseReportingRange(query);
      const result = await this.service.getOrchestrationReporting(window);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  recentDeliveries = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = req.query as unknown as RecentDeliveriesQuery;
      const window = parseReportingRange(query);
      const result = await this.service.getRecentDeliveries(window, query.limit);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  recentActivity = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = req.query as unknown as RecentActivityQuery;
      const result = await this.service.getRecentActivity(query.hours, query.limit);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  feedback = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as FeedbackReportingQuery;
      const window = parseReportingRange(query);
      const result = await this.service.getFeedbackReporting(window, query.recentLimit);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const reportingController = new ReportingController();
