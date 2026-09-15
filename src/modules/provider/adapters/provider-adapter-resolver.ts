import { AppError } from "../../../core/errors/app-error.js";
import { ErrorCodes } from "../../../core/errors/error-codes.js";
import {
  getMissingCapabilitiesForOperation,
  operationRequiresCapability,
} from "./provider-adapter.capabilities.js";
import type {
  AdapterOperation,
  ProviderAdapter,
} from "./provider-adapter.types.js";
import {
  ProviderAdapterRegistry,
  providerAdapterRegistry,
} from "./provider-adapter-registry.js";
import {
  ProviderConfigResolver,
  providerConfigResolver,
} from "./provider-config-resolver.js";
import type { ProviderRuntimeConfig } from "./provider-config.types.js";

export type ResolvedAdapterExecution = {
  adapter: ProviderAdapter;
  config: ProviderRuntimeConfig;
};

export class ProviderAdapterResolver {
  constructor(
    private readonly registry: ProviderAdapterRegistry = providerAdapterRegistry,
    private readonly configResolver: ProviderConfigResolver = providerConfigResolver,
  ) {}

  async resolveForExecution(input: {
    providerCode: string;
    operation: AdapterOperation;
    requestId: string;
    requireReady?: boolean;
  }): Promise<ResolvedAdapterExecution> {
    const providerCode = input.providerCode.toUpperCase();
    let config: ProviderRuntimeConfig;
    try {
      config = await this.configResolver.resolveByCode(providerCode);
    } catch (error) {
      if (
        error instanceof Error &&
        (error as Error & { code?: string }).code === "PROVIDER_NOT_FOUND"
      ) {
        throw new AppError("Provider not found.", {
          statusCode: 404,
          code: ErrorCodes.PROVIDER_NOT_FOUND,
        });
      }
      throw error;
    }

    return this.finalizeResolution({
      config,
      operation: input.operation,
      requireReady: input.requireReady,
    });
  }

  async resolveByIdForExecution(input: {
    providerId: string;
    operation: AdapterOperation;
    requestId: string;
    requireReady?: boolean;
  }): Promise<ResolvedAdapterExecution> {
    let config: ProviderRuntimeConfig;
    try {
      config = await this.configResolver.resolveById(input.providerId);
    } catch (error) {
      if (
        error instanceof Error &&
        (error as Error & { code?: string }).code === "PROVIDER_NOT_FOUND"
      ) {
        throw new AppError("Provider not found.", {
          statusCode: 404,
          code: ErrorCodes.PROVIDER_NOT_FOUND,
        });
      }
      throw error;
    }

    return this.finalizeResolution({
      config,
      operation: input.operation,
      requireReady: input.requireReady,
    });
  }

  private finalizeResolution(input: {
    config: ProviderRuntimeConfig;
    operation: AdapterOperation;
    requireReady?: boolean;
  }): ResolvedAdapterExecution {
    const { config, operation } = input;
    const providerCode = config.providerCode.toUpperCase();

    if (!config.enabled || config.status === "INACTIVE") {
      throw new AppError("Provider is disabled.", {
        statusCode: 422,
        code: ErrorCodes.PROVIDER_DISABLED,
      });
    }

    if (config.integrationStatus === "NOT_CONFIGURED") {
      throw new AppError("Provider is not configured.", {
        statusCode: 422,
        code: ErrorCodes.PROVIDER_NOT_READY,
      });
    }

    if (input.requireReady !== false && config.integrationStatus !== "READY") {
      throw new AppError("Provider is not ready for execution.", {
        statusCode: 422,
        code: ErrorCodes.PROVIDER_NOT_READY,
      });
    }

    const adapter = this.registry.resolve(providerCode);
    if (!adapter) {
      throw new AppError("Provider adapter is not available.", {
        statusCode: 422,
        code: ErrorCodes.PROVIDER_ADAPTER_NOT_AVAILABLE,
      });
    }

    const configuredCapabilities = new Set(config.capabilities);
    if (!operationRequiresCapability(operation, configuredCapabilities)) {
      const missing = getMissingCapabilitiesForOperation(
        operation,
        configuredCapabilities,
      );
      throw new AppError(
        `Provider does not support required capabilities: ${missing.join(", ")}.`,
        {
          statusCode: 422,
          code: ErrorCodes.PROVIDER_UNSUPPORTED_OPERATION,
        },
      );
    }

    if (!adapter.supportsOperation(operation)) {
      throw new AppError("Provider adapter does not support this operation.", {
        statusCode: 422,
        code: ErrorCodes.PROVIDER_UNSUPPORTED_OPERATION,
      });
    }

    return { adapter, config };
  }
}

export const providerAdapterResolver = new ProviderAdapterResolver();
