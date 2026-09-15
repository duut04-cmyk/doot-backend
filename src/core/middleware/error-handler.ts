import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";

type ErrorBody = {
  success: false;
  error: {
    code: string;
    message: string;
  };
  requestId: string;
};

export function errorHandlerMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = req.requestId ?? "unknown";

  let statusCode = 500;
  let code: string = ErrorCodes.INTERNAL_ERROR;
  let message = "An unexpected error occurred";

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
  } else if (err instanceof ZodError) {
    statusCode = 400;
    code = ErrorCodes.VALIDATION_ERROR;
    message = err.issues.map((issue) => issue.message).join("; ");
  } else if (
    err instanceof SyntaxError &&
    "type" in err &&
    (err as { type?: string }).type === "entity.parse.failed"
  ) {
    statusCode = 400;
    code = ErrorCodes.VALIDATION_ERROR;
    message = "Request body must be valid JSON.";
  } else if (err instanceof Error) {
    message =
      env.NODE_ENV === "production"
        ? "An unexpected error occurred"
        : err.message;
  }

  logger.error(
    {
      err,
      requestId,
      path: req.path,
      method: req.method,
      statusCode,
      code,
    },
    "Request failed",
  );

  const body: ErrorBody = {
    success: false,
    error: {
      code,
      message,
    },
    requestId,
  };

  res.status(statusCode).json(body);
}
