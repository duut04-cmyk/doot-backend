import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import { validateAdapterOperationOutput } from "./contracts/operation-schemas.js";
import { availabilityResultSchema } from "./contracts/availability.js";
import { normalizedQuoteSchema } from "./contracts/quote.js";
import { normalizedServiceabilityResultSchema } from "./contracts/serviceability.js";
import type { QuoteRequest } from "./contracts/quote.js";
import {
  ProviderAdapterResolver,
  providerAdapterResolver,
} from "./adapters/provider-adapter-resolver.js";
import {
  isQuoteProbeAdapter,
  type ProviderQuoteProbeResult,
} from "./adapters/provider-adapter.types.js";
import { ProviderAdapterError } from "./contracts/provider-error.js";

export type ProviderConnectionTestResult = {
  providerCode: string;
  environment: string;
  connected: boolean;
  latencyMs: number;
};

export class ProviderIntegrationService {
  constructor(
    private readonly resolver: ProviderAdapterResolver = providerAdapterResolver,
  ) {}

  async testConnection(input: {
    providerId: string;
    requestId: string;
  }): Promise<{ success: true; data: ProviderConnectionTestResult }> {
    const started = Date.now();
    const resolved = await this.resolver.resolveByIdForExecution({
      providerId: input.providerId,
      operation: "healthCheck",
      requestId: input.requestId,
      requireReady: false,
    });

    try {
      const result = await resolved.adapter.execute(
        "healthCheck",
        {},
        {
          requestId: input.requestId,
          config: resolved.config,
        },
      );

      validateAdapterOperationOutput("healthCheck", result);

      return {
        success: true,
        data: {
          providerCode: resolved.config.providerCode,
          environment: resolved.config.environment,
          connected: result.healthy,
          latencyMs: Date.now() - started,
        },
      };
    } catch (error) {
      if (error instanceof ProviderAdapterError) {
        return {
          success: true,
          data: {
            providerCode: resolved.config.providerCode,
            environment: resolved.config.environment,
            connected: false,
            latencyMs: Date.now() - started,
          },
        };
      }
      throw error;
    }
  }

  async testQuote(input: {
    providerId: string;
    body: QuoteRequest;
    requestId: string;
  }): Promise<{ success: true; data: ProviderQuoteProbeResult }> {
    const resolved = await this.resolver.resolveByIdForExecution({
      providerId: input.providerId,
      operation: "getQuote",
      requestId: input.requestId,
      requireReady: false,
    });

    if (!isQuoteProbeAdapter(resolved.adapter)) {
      throw new AppError(
        "Provider adapter does not support quote probing.",
        {
          statusCode: 422,
          code: ErrorCodes.PROVIDER_UNSUPPORTED_OPERATION,
        },
      );
    }

    try {
      const result = await resolved.adapter.probeQuote(input.body, {
        requestId: input.requestId,
        config: resolved.config,
      });

      normalizedQuoteSchema.parse(result.quote);
      normalizedServiceabilityResultSchema.parse(result.serviceability);
      availabilityResultSchema.parse(result.availability);

      return {
        success: true,
        data: {
          ...result,
          providerCode: resolved.config.providerCode,
        },
      };
    } catch (error) {
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

export const providerIntegrationService = new ProviderIntegrationService();
