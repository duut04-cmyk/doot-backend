import { logger } from "../../../config/logger.js";
import { AppError } from "../../../core/errors/app-error.js";
import { ErrorCodes } from "../../../core/errors/error-codes.js";
import { validateAdapterOperationOutput } from "../contracts/operation-schemas.js";
import { ProviderAdapterError } from "../contracts/provider-error.js";
import type {
  AdapterExecutionContext,
  AdapterOperation,
  AdapterOperationInput,
  AdapterOperationOutput,
} from "./provider-adapter.types.js";
import {
  ProviderAdapterResolver,
  providerAdapterResolver,
} from "./provider-adapter-resolver.js";

export class ProviderAdapterExecutor {
  constructor(
    private readonly resolver: ProviderAdapterResolver = providerAdapterResolver,
  ) {}

  async execute<T extends AdapterOperation>(input: {
    providerCode: string;
    operation: T;
    payload: AdapterOperationInput<T>;
    requestId: string;
    requireReady?: boolean;
    testHints?: AdapterExecutionContext["testHints"];
  }): Promise<AdapterOperationOutput<T>> {
    const started = Date.now();
    let providerCode = input.providerCode.toUpperCase();

    try {
      const resolved = await this.resolver.resolveForExecution({
        providerCode,
        operation: input.operation,
        requestId: input.requestId,
        requireReady: input.requireReady,
      });
      providerCode = resolved.config.providerCode;

      const ctx: AdapterExecutionContext = {
        requestId: input.requestId,
        config: resolved.config,
        testHints: input.testHints,
      };

      const result = await resolved.adapter.execute(
        input.operation,
        input.payload,
        ctx,
      );

      validateAdapterOperationOutput(input.operation, result);

      logger.info(
        {
          requestId: input.requestId,
          providerCode,
          operation: input.operation,
          durationMs: Date.now() - started,
          success: true,
        },
        "provider_adapter_executed",
      );

      return result;
    } catch (error) {
      logger.warn(
        {
          requestId: input.requestId,
          providerCode,
          operation: input.operation,
          durationMs: Date.now() - started,
          success: false,
          errorCategory:
            error instanceof ProviderAdapterError ? error.category : undefined,
          errorCode:
            error instanceof AppError
              ? error.code
              : error instanceof ProviderAdapterError
                ? error.category
                : ErrorCodes.INTERNAL_ERROR,
        },
        "provider_adapter_failed",
      );

      if (error instanceof AppError) {
        throw error;
      }
      if (error instanceof ProviderAdapterError) {
        throw new AppError(error.safeMessage, {
          statusCode: mapProviderErrorStatus(error.category),
          code: ErrorCodes.PROVIDER_ADAPTER_ERROR,
          cause: error,
        });
      }
      throw error;
    }
  }
}

function mapProviderErrorStatus(category: string): number {
  switch (category) {
    case "PROVIDER_AUTHENTICATION_ERROR":
    case "PROVIDER_AUTHORIZATION_ERROR":
      return 401;
    case "PROVIDER_VALIDATION_ERROR":
      return 400;
    case "PROVIDER_NOT_FOUND":
      return 404;
    case "PROVIDER_UNSUPPORTED_OPERATION":
      return 422;
    case "PROVIDER_RATE_LIMITED":
      return 429;
    case "PROVIDER_TIMEOUT":
    case "PROVIDER_SERVICE_UNAVAILABLE":
      return 503;
    default:
      return 502;
  }
}

export const providerAdapterExecutor = new ProviderAdapterExecutor();
