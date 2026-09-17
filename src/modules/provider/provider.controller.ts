import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import type {
  CreateProviderBody,
  CreateProviderServiceBody,
  CreateProviderVehicleBody,
  ProviderIdParams,
  ProviderServiceParams,
  ProviderVehicleParams,
  ReplaceCapabilitiesBody,
  UpdateProviderBody,
  UpdateProviderServiceBody,
  UpdateProviderStatusBody,
  UpdateProviderVehicleBody,
  UpsertCredentialsBody,
  ProviderTestQuoteBody,
} from "./provider.schema.js";
import {
  providerIntegrationService,
  type ProviderIntegrationService,
} from "./provider.integration.service.js";
import { providerService, type ProviderService } from "./provider.service.js";

function requireUser(req: Request) {
  if (!req.user) {
    throw new AppError("Authentication required.", {
      statusCode: 401,
      code: ErrorCodes.UNAUTHORIZED,
    });
  }
  return req.user;
}

function auditContext(req: Request) {
  const user = requireUser(req);
  return {
    adminUserId: user.id,
    requestId: req.requestId,
  };
}

export class ProviderController {
  constructor(
    private readonly service: ProviderService = providerService,
    private readonly integrationService: ProviderIntegrationService = providerIntegrationService,
  ) {}

  create = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.service.createProvider({
        body: req.body as CreateProviderBody,
        audit: auditContext(req),
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
      requireUser(req);
      const result = await this.service.listProviders();
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
      requireUser(req);
      const params = req.params as unknown as ProviderIdParams;
      const result = await this.service.getProvider(params.id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  update = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const params = req.params as unknown as ProviderIdParams;
      const result = await this.service.updateProvider({
        providerId: params.id,
        body: req.body as UpdateProviderBody,
        audit: auditContext(req),
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  updateStatus = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const params = req.params as unknown as ProviderIdParams;
      const result = await this.service.updateProviderStatus({
        providerId: params.id,
        body: req.body as UpdateProviderStatusBody,
        audit: auditContext(req),
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  upsertCredentials = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const params = req.params as unknown as ProviderIdParams;
      const result = await this.service.upsertCredentials({
        providerId: params.id,
        body: req.body as UpsertCredentialsBody,
        audit: auditContext(req),
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  replaceCapabilities = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const params = req.params as unknown as ProviderIdParams;
      const result = await this.service.replaceCapabilities({
        providerId: params.id,
        body: req.body as ReplaceCapabilitiesBody,
        audit: auditContext(req),
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  createService = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const params = req.params as unknown as ProviderIdParams;
      const result = await this.service.createService({
        providerId: params.id,
        body: req.body as CreateProviderServiceBody,
        audit: auditContext(req),
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  listServices = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      requireUser(req);
      const params = req.params as unknown as ProviderIdParams;
      const result = await this.service.listServices(params.id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  updateService = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const params = req.params as unknown as ProviderServiceParams;
      const result = await this.service.updateService({
        providerId: params.id,
        serviceId: params.serviceId,
        body: req.body as UpdateProviderServiceBody,
        audit: auditContext(req),
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  createVehicle = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const params = req.params as unknown as ProviderIdParams;
      const result = await this.service.createVehicle({
        providerId: params.id,
        body: req.body as CreateProviderVehicleBody,
        audit: auditContext(req),
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  listVehicles = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      requireUser(req);
      const params = req.params as unknown as ProviderIdParams;
      const result = await this.service.listVehicles(params.id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  updateVehicle = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const params = req.params as unknown as ProviderVehicleParams;
      const result = await this.service.updateVehicle({
        providerId: params.id,
        vehicleId: params.vehicleId,
        body: req.body as UpdateProviderVehicleBody,
        audit: auditContext(req),
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  testConnection = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const params = req.params as unknown as ProviderIdParams;
      const result = await this.integrationService.testConnection({
        providerId: params.id,
        requestId: req.requestId,
      });
      await this.service.recordConnectionTestResult({
        providerId: params.id,
        connected: result.data.connected,
        audit: auditContext(req),
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  testQuote = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const params = req.params as unknown as ProviderIdParams;
      const result = await this.integrationService.testQuote({
        providerId: params.id,
        body: req.body as ProviderTestQuoteBody,
        requestId: req.requestId,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const providerController = new ProviderController();
