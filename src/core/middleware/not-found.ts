import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";

export function notFoundMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  next(
    new AppError(`Route not found: ${req.method} ${req.path}`, {
      statusCode: 404,
      code: ErrorCodes.NOT_FOUND,
    }),
  );
}
