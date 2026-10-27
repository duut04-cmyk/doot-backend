import { env } from "../../../../config/env.js";
import { logger } from "../../../../config/logger.js";
import { AppError } from "../../../../core/errors/app-error.js";
import { ErrorCodes } from "../../../../core/errors/error-codes.js";
import { ProviderAdapterError } from "../../contracts/provider-error.js";
import type { ProviderRuntimeConfig } from "../provider-config.types.js";
import { ProviderHttpClient } from "../provider-http-client.js";
import {
  SHIPROCKET_AUTH_PATH,
  SHIPROCKET_TOKEN_REFRESH_BUFFER_MS,
  SHIPROCKET_TOKEN_TTL_MS,
} from "./shiprocket.constants.js";
import { shiprocketLoginResponseSchema } from "./shiprocket.types.js";

type CachedToken = {
  token: string;
  expiresAt: number;
};

let cachedToken: CachedToken | null = null;

function extractToken(body: unknown): string {
  const parsed = shiprocketLoginResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new ProviderAdapterError({
      providerCode: "SHIPROCKET",
      operation: "healthCheck",
      category: "PROVIDER_UNKNOWN_ERROR",
      safeMessage: "Shiprocket login returned an unexpected response.",
    });
  }
  const token = parsed.data.token ?? parsed.data.data?.token;
  if (!token) {
    throw new ProviderAdapterError({
      providerCode: "SHIPROCKET",
      operation: "healthCheck",
      category: "PROVIDER_UNKNOWN_ERROR",
      safeMessage: "Shiprocket login did not return a token.",
    });
  }
  return token;
}

export class ShiprocketAuthService {
  constructor(private readonly http: ProviderHttpClient = new ProviderHttpClient()) {}

  clearCacheForTests(): void {
    cachedToken = null;
  }

  async getBearerToken(input: {
    config: ProviderRuntimeConfig;
    requestId: string;
    forceRefresh?: boolean;
  }): Promise<string> {
    if (!env.SHIPROCKET_ENABLED && env.NODE_ENV !== "test") {
      throw new AppError("Shiprocket integration is disabled.", {
        statusCode: 503,
        code: ErrorCodes.PROVIDER_NOT_READY,
      });
    }

    const now = Date.now();
    if (
      !input.forceRefresh &&
      cachedToken &&
      cachedToken.expiresAt - SHIPROCKET_TOKEN_REFRESH_BUFFER_MS > now
    ) {
      return cachedToken.token;
    }

    const email = env.SHIPROCKET_AUTH_EMAIL;
    const password = env.SHIPROCKET_AUTH_PASSWORD;
    if (!email || !password) {
      throw new AppError("Shiprocket credentials are not configured.", {
        statusCode: 503,
        code: ErrorCodes.PROVIDER_NOT_READY,
      });
    }

    const response = await this.http.request({
      config: input.config,
      operation: "healthCheck",
      requestId: input.requestId,
      request: {
        method: "POST",
        path: SHIPROCKET_AUTH_PATH,
        body: { email, password },
      },
      allowErrorResponseBody: true,
    });

    if (response.status === 498) {
      throw new ProviderAdapterError({
        providerCode: "SHIPROCKET",
        operation: "healthCheck",
        category: "PROVIDER_SERVICE_UNAVAILABLE",
        safeMessage: "Shiprocket access was denied by edge infrastructure.",
        retryable: false,
      });
    }

    if (response.status === 401 || response.status === 403) {
      throw new ProviderAdapterError({
        providerCode: "SHIPROCKET",
        operation: "healthCheck",
        category: "PROVIDER_AUTHENTICATION_ERROR",
        safeMessage: "Shiprocket authentication failed.",
      });
    }

    if (response.status < 200 || response.status >= 300) {
      throw new ProviderAdapterError({
        providerCode: "SHIPROCKET",
        operation: "healthCheck",
        category: "PROVIDER_SERVICE_UNAVAILABLE",
        safeMessage: "Shiprocket authentication is temporarily unavailable.",
      });
    }

    const token = extractToken(response.data);
    cachedToken = {
      token,
      expiresAt: now + SHIPROCKET_TOKEN_TTL_MS,
    };

    logger.info(
      {
        providerCode: "SHIPROCKET",
        requestId: input.requestId,
        tokenExpiresAt: new Date(cachedToken.expiresAt).toISOString(),
      },
      "shiprocket_auth_token_cached",
    );

    return token;
  }
}

export const shiprocketAuthService = new ShiprocketAuthService();
