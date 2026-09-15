import type { UserRole } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";

/**
 * Role-based authorization. Must run after `authenticate`.
 * Uses the database-backed role on `req.user` (never client-supplied role).
 */
export function requireRole(...allowedRoles: UserRole[]) {
  if (allowedRoles.length === 0) {
    throw new Error("requireRole requires at least one role");
  }

  return function authorize(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void {
    try {
      if (!req.user) {
        throw new AppError("Authentication required.", {
          statusCode: 401,
          code: ErrorCodes.UNAUTHORIZED,
        });
      }

      if (!allowedRoles.includes(req.user.role)) {
        throw new AppError(
          "You do not have permission to access this resource.",
          {
            statusCode: 403,
            code: ErrorCodes.FORBIDDEN,
          },
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
