import { ErrorCode, ErrorCodes } from "./error-codes.js";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    options: {
      statusCode?: number;
      code?: ErrorCode;
      isOperational?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.statusCode = options.statusCode ?? 500;
    this.code = options.code ?? ErrorCodes.INTERNAL_ERROR;
    this.isOperational = options.isOperational ?? true;
  }
}
