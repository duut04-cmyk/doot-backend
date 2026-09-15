import type { NextFunction, Request, Response } from "express";
import { logger } from "../../config/logger.js";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";
import { verifyAccessToken } from "../../modules/auth/auth.crypto.js";
import {
  authRepository,
  type IAuthRepository,
} from "../../modules/auth/auth.repository.js";
import { toAuthenticatedUser } from "../../modules/auth/auth.types.js";

function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  const [scheme, token, ...rest] = header.split(" ");
  if (scheme !== "Bearer" || !token || rest.length > 0) {
    return null;
  }

  return token;
}

export function createAuthenticateMiddleware(
  repository: IAuthRepository = authRepository,
) {
  return async function authenticate(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const rawToken = extractBearerToken(req.header("authorization"));
      if (!rawToken) {
        throw new AppError("Authentication required.", {
          statusCode: 401,
          code: ErrorCodes.UNAUTHORIZED,
        });
      }

      const payload = verifyAccessToken(rawToken);
      const user = await repository.findAuthenticatedUserById(payload.sub);

      if (!user) {
        logger.info(
          { requestId: req.requestId },
          "authenticated_request_failed",
        );
        throw new AppError("Invalid or expired access token.", {
          statusCode: 401,
          code: ErrorCodes.INVALID_ACCESS_TOKEN,
        });
      }

      if (user.status === "SUSPENDED") {
        throw new AppError("Account is suspended.", {
          statusCode: 403,
          code: ErrorCodes.ACCOUNT_SUSPENDED,
        });
      }

      if (user.status === "DELETED") {
        throw new AppError("Account is unavailable.", {
          statusCode: 403,
          code: ErrorCodes.ACCOUNT_DELETED,
        });
      }

      if (user.status !== "ACTIVE") {
        throw new AppError("Authentication required.", {
          statusCode: 401,
          code: ErrorCodes.UNAUTHORIZED,
        });
      }

      req.user = toAuthenticatedUser(user);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const authenticate = createAuthenticateMiddleware();
