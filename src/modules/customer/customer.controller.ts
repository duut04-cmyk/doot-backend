import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import type {
  CustomerIdParams,
  ListCustomersQuery,
  UpdateCustomerBody,
} from "./customer.schema.js";
import { customerService, type CustomerService } from "./customer.service.js";

function requireUser(req: Request) {
  if (!req.user) {
    throw new AppError("Authentication required.", {
      statusCode: 401,
      code: ErrorCodes.UNAUTHORIZED,
    });
  }
  return req.user;
}

export class CustomerController {
  constructor(private readonly service: CustomerService = customerService) {}

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      requireUser(req);
      const result = await this.service.listCustomers(
        req.query as unknown as ListCustomersQuery,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      requireUser(req);
      const { id } = req.params as unknown as CustomerIdParams;
      const result = await this.service.getCustomer(id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      requireUser(req);
      const { id } = req.params as unknown as CustomerIdParams;
      const result = await this.service.updateCustomer({
        customerId: id,
        body: req.body as UpdateCustomerBody,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const customerController = new CustomerController();
