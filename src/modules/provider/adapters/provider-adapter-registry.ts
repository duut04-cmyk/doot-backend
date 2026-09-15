import { AppError } from "../../../core/errors/app-error.js";
import { ErrorCodes } from "../../../core/errors/error-codes.js";
import type { ProviderAdapter, ProviderAdapterMetadata } from "./provider-adapter.types.js";

export class ProviderAdapterRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    const code = adapter.metadata.providerCode.toUpperCase();
    if (this.adapters.has(code)) {
      throw new AppError(
        `Adapter for provider ${code} is already registered.`,
        {
          statusCode: 409,
          code: ErrorCodes.CONFLICT,
        },
      );
    }
    this.adapters.set(code, adapter);
  }

  resolve(providerCode: string): ProviderAdapter | null {
    return this.adapters.get(providerCode.toUpperCase()) ?? null;
  }

  has(providerCode: string): boolean {
    return this.adapters.has(providerCode.toUpperCase());
  }

  list(): ProviderAdapterMetadata[] {
    return [...this.adapters.values()].map((adapter) => adapter.metadata);
  }
}

export const providerAdapterRegistry = new ProviderAdapterRegistry();
