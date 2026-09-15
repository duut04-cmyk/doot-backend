import { AppError } from "../../../../core/errors/app-error.js";
import { ErrorCodes } from "../../../../core/errors/error-codes.js";
import { ProviderAdapterError } from "../../contracts/provider-error.js";
import type { AdapterOperation } from "../provider-adapter.types.js";
import type { ProviderRuntimeConfig } from "../provider-config.types.js";
import {
  ProviderHttpClient,
  providerHttpClient,
} from "../provider-http-client.js";
import {
  BORZO_AUTH_HEADER,
  BORZO_CALCULATE_ORDER_PATH,
  BORZO_PROVIDER_CODE,
} from "./borzo.constants.js";
import { assertBorzoPhase4Environment } from "./borzo.mapper.js";
import {
  borzoCalculateOrderResponseSchema,
  borzoHealthResponseSchema,
} from "./borzo.schemas.js";
import type {
  BorzoCalculateOrderRequest,
  BorzoCalculateOrderResponse,
  BorzoHealthResponse,
} from "./borzo.types.js";

export class BorzoClient {
  constructor(
    private readonly httpClient: ProviderHttpClient = providerHttpClient,
  ) {}

  private resolveAuthToken(config: ProviderRuntimeConfig): string {
    const token =
      config.credentials.ACCESS_TOKEN ?? config.credentials.API_KEY ?? null;
    if (!token?.trim()) {
      throw new ProviderAdapterError({
        providerCode: BORZO_PROVIDER_CODE,
        operation: "getQuote",
        category: "PROVIDER_AUTHENTICATION_ERROR",
        safeMessage: "Borzo authentication token is not configured.",
        retryable: false,
      });
    }
    return token.trim();
  }

  private validateEnvironment(config: ProviderRuntimeConfig): void {
    try {
      assertBorzoPhase4Environment(config.environment, config.baseUrl);
    } catch {
      throw new AppError("Borzo environment is not allowed for Phase 4.", {
        statusCode: 422,
        code: ErrorCodes.PROVIDER_CONFIGURATION_INVALID,
      });
    }
  }

  private buildHeaders(config: ProviderRuntimeConfig): Record<string, string> {
    return {
      [BORZO_AUTH_HEADER]: this.resolveAuthToken(config),
    };
  }

  async ping(input: {
    config: ProviderRuntimeConfig;
    requestId: string;
    operation?: AdapterOperation;
  }): Promise<{ healthy: boolean; durationMs: number }> {
    this.validateEnvironment(input.config);
    const operation = input.operation ?? "healthCheck";
    const response = await this.httpClient.request<BorzoHealthResponse>({
      config: input.config,
      operation,
      requestId: input.requestId,
      request: {
        method: "GET",
        path: "",
        headers: this.buildHeaders(input.config),
      },
    });

    const parsed = borzoHealthResponseSchema.safeParse(response.data);
    if (!parsed.success) {
      throw new ProviderAdapterError({
        providerCode: BORZO_PROVIDER_CODE,
        operation,
        category: "PROVIDER_UNKNOWN_ERROR",
        safeMessage: "Borzo health response was malformed.",
        requestId: input.requestId,
      });
    }

    return {
      healthy: parsed.data.is_successful === true,
      durationMs: response.durationMs,
    };
  }

  async calculateOrder(input: {
    config: ProviderRuntimeConfig;
    requestId: string;
    body: BorzoCalculateOrderRequest;
    operation?: AdapterOperation;
  }): Promise<BorzoCalculateOrderResponse> {
    this.validateEnvironment(input.config);
    const operation = input.operation ?? "getQuote";

    const response = await this.httpClient.request<BorzoCalculateOrderResponse>(
      {
        config: input.config,
        operation,
        requestId: input.requestId,
        allowErrorResponseBody: true,
        request: {
          method: "POST",
          path: BORZO_CALCULATE_ORDER_PATH,
          headers: this.buildHeaders(input.config),
          body: input.body,
        },
      },
    );

    if (response.status === 401 || response.status === 403) {
      throw new ProviderAdapterError({
        providerCode: BORZO_PROVIDER_CODE,
        operation,
        category:
          response.status === 401
            ? "PROVIDER_AUTHENTICATION_ERROR"
            : "PROVIDER_AUTHORIZATION_ERROR",
        safeMessage: "Borzo authentication failed.",
        providerErrorCode: String(response.status),
        requestId: input.requestId,
      });
    }

    const parsed = borzoCalculateOrderResponseSchema.safeParse(response.data);
    if (!parsed.success) {
      throw new ProviderAdapterError({
        providerCode: BORZO_PROVIDER_CODE,
        operation,
        category: "PROVIDER_UNKNOWN_ERROR",
        safeMessage: "Borzo calculate-order response was malformed.",
        requestId: input.requestId,
      });
    }

    return parsed.data as BorzoCalculateOrderResponse;
  }
}

export const borzoClient = new BorzoClient();
