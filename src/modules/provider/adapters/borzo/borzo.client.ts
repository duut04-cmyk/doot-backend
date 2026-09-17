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
  BORZO_CANCEL_ORDER_PATH,
  BORZO_COURIER_PATH,
  BORZO_CREATE_ORDER_PATH,
  BORZO_ORDERS_PATH,
  BORZO_PROVIDER_CODE,
} from "./borzo.constants.js";
import { assertBorzoPhase4Environment } from "./borzo.mapper.js";
import {
  borzoCalculateOrderResponseSchema,
  borzoCancelOrderResponseSchema,
  borzoCourierResponseSchema,
  borzoCreateOrderResponseSchema,
  borzoHealthResponseSchema,
  borzoOrdersListResponseSchema,
} from "./borzo.schemas.js";
import type {
  BorzoCalculateOrderRequest,
  BorzoCalculateOrderResponse,
  BorzoCancelOrderRequest,
  BorzoCancelOrderResponse,
  BorzoCourierResponse,
  BorzoCreateOrderRequest,
  BorzoCreateOrderResponse,
  BorzoHealthResponse,
  BorzoOrdersListResponse,
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

  private mapHttpAuthError(
    status: number,
    operation: AdapterOperation,
    requestId: string,
  ): ProviderAdapterError {
    return new ProviderAdapterError({
      providerCode: BORZO_PROVIDER_CODE,
      operation,
      category:
        status === 401
          ? "PROVIDER_AUTHENTICATION_ERROR"
          : "PROVIDER_AUTHORIZATION_ERROR",
      safeMessage: "Borzo authentication failed.",
      providerErrorCode: String(status),
      requestId,
      retryable: false,
    });
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
    return this.postOrderOperation({
      ...input,
      path: BORZO_CALCULATE_ORDER_PATH,
      operation: input.operation ?? "getQuote",
      schema: borzoCalculateOrderResponseSchema,
      malformedMessage: "Borzo calculate-order response was malformed.",
    });
  }

  async createOrder(input: {
    config: ProviderRuntimeConfig;
    requestId: string;
    body: BorzoCreateOrderRequest;
    operation?: AdapterOperation;
  }): Promise<BorzoCreateOrderResponse> {
    return this.postOrderOperation({
      ...input,
      path: BORZO_CREATE_ORDER_PATH,
      operation: input.operation ?? "createBooking",
      schema: borzoCreateOrderResponseSchema,
      malformedMessage: "Borzo create-order response was malformed.",
    });
  }

  async cancelOrder(input: {
    config: ProviderRuntimeConfig;
    requestId: string;
    body: BorzoCancelOrderRequest;
    operation?: AdapterOperation;
  }): Promise<BorzoCancelOrderResponse> {
    return this.postOrderOperation({
      ...input,
      path: BORZO_CANCEL_ORDER_PATH,
      operation: input.operation ?? "cancelBooking",
      schema: borzoCancelOrderResponseSchema,
      malformedMessage: "Borzo cancel-order response was malformed.",
    });
  }

  async getCourier(input: {
    config: ProviderRuntimeConfig;
    requestId: string;
    orderId: number;
    operation?: AdapterOperation;
  }): Promise<BorzoCourierResponse> {
    this.validateEnvironment(input.config);
    const operation = input.operation ?? "getTracking";

    const response = await this.httpClient.request<BorzoCourierResponse>({
      config: input.config,
      operation,
      requestId: input.requestId,
      allowErrorResponseBody: true,
      request: {
        method: "GET",
        path: `${BORZO_COURIER_PATH}?order_id=${input.orderId}`,
        headers: this.buildHeaders(input.config),
      },
    });

    if (response.status === 401 || response.status === 403) {
      throw this.mapHttpAuthError(response.status, operation, input.requestId);
    }

    const parsed = borzoCourierResponseSchema.safeParse(response.data);
    if (!parsed.success) {
      throw new ProviderAdapterError({
        providerCode: BORZO_PROVIDER_CODE,
        operation,
        category: "PROVIDER_UNKNOWN_ERROR",
        safeMessage: "Borzo courier response was malformed.",
        requestId: input.requestId,
      });
    }

    return parsed.data as BorzoCourierResponse;
  }

  async getOrder(input: {
    config: ProviderRuntimeConfig;
    requestId: string;
    orderId: number;
    operation?: AdapterOperation;
  }): Promise<BorzoOrdersListResponse> {
    this.validateEnvironment(input.config);
    const operation = input.operation ?? "getBooking";

    const response = await this.httpClient.request<BorzoOrdersListResponse>({
      config: input.config,
      operation,
      requestId: input.requestId,
      allowErrorResponseBody: true,
      request: {
        method: "GET",
        path: `${BORZO_ORDERS_PATH}?order_id=${input.orderId}`,
        headers: this.buildHeaders(input.config),
      },
    });

    if (response.status === 401 || response.status === 403) {
      throw this.mapHttpAuthError(response.status, operation, input.requestId);
    }

    const parsed = borzoOrdersListResponseSchema.safeParse(response.data);
    if (!parsed.success) {
      throw new ProviderAdapterError({
        providerCode: BORZO_PROVIDER_CODE,
        operation,
        category: "PROVIDER_UNKNOWN_ERROR",
        safeMessage: "Borzo orders response was malformed.",
        requestId: input.requestId,
      });
    }

    return parsed.data as BorzoOrdersListResponse;
  }

  private async postOrderOperation<TResponse>(input: {
    config: ProviderRuntimeConfig;
    requestId: string;
    body: BorzoCalculateOrderRequest | BorzoCancelOrderRequest;
    path: string;
    operation: AdapterOperation;
    schema: { safeParse: (value: unknown) => { success: boolean; data?: TResponse } };
    malformedMessage: string;
  }): Promise<TResponse> {
    this.validateEnvironment(input.config);

    const response = await this.httpClient.request<TResponse>({
      config: input.config,
      operation: input.operation,
      requestId: input.requestId,
      allowErrorResponseBody: true,
      request: {
        method: "POST",
        path: input.path,
        headers: this.buildHeaders(input.config),
        body: input.body,
      },
    });

    if (response.status === 401 || response.status === 403) {
      throw this.mapHttpAuthError(
        response.status,
        input.operation,
        input.requestId,
      );
    }

    const parsed = input.schema.safeParse(response.data);
    if (!parsed.success) {
      throw new ProviderAdapterError({
        providerCode: BORZO_PROVIDER_CODE,
        operation: input.operation,
        category: "PROVIDER_UNKNOWN_ERROR",
        safeMessage: input.malformedMessage,
        requestId: input.requestId,
      });
    }

    return parsed.data as TResponse;
  }
}

export const borzoClient = new BorzoClient();
