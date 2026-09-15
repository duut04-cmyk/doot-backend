import type { ProviderCredentialField } from "@prisma/client";
import { AppError } from "../../../core/errors/app-error.js";
import { ErrorCodes } from "../../../core/errors/error-codes.js";
import { decryptCredential } from "../provider.crypto.js";
import {
  providerRepository,
  type IProviderRepository,
} from "../provider.repository.js";
import { resolveTrustedProviderBaseUrl } from "./provider.adapter-urls.js";
import type { ProviderRuntimeConfig } from "./provider-config.types.js";

export class ProviderConfigResolver {
  constructor(
    private readonly repository: IProviderRepository = providerRepository,
  ) {}

  async resolveById(providerId: string): Promise<ProviderRuntimeConfig> {
    const withRelations = await this.repository.findById(providerId);
    if (!withRelations) {
      throw new AppError("Provider not found.", {
        statusCode: 404,
        code: ErrorCodes.PROVIDER_NOT_FOUND,
      });
    }
    return this.buildRuntimeConfig(withRelations);
  }

  async resolveByCode(providerCode: string): Promise<ProviderRuntimeConfig> {
    const provider = await this.repository.findByCode(providerCode);
    if (!provider) {
      throw new AppError("Provider not found.", {
        statusCode: 404,
        code: ErrorCodes.PROVIDER_NOT_FOUND,
      });
    }
    return this.resolveById(provider.id);
  }

  private buildRuntimeConfig(
    withRelations: NonNullable<
      Awaited<ReturnType<IProviderRepository["findById"]>>
    >,
  ): ProviderRuntimeConfig {
    const credentials: Partial<Record<ProviderCredentialField, string>> = {};
    for (const record of withRelations.credentials) {
      if (!record.isActive) continue;
      credentials[record.fieldName] = decryptCredential({
        ciphertext: record.ciphertext,
        iv: record.iv,
        authTag: record.authTag,
      });
    }

    return {
      providerId: withRelations.id,
      providerCode: withRelations.code,
      environment: withRelations.environment,
      status: withRelations.status,
      enabled: withRelations.enabled,
      integrationStatus: withRelations.integrationStatus,
      baseUrl: resolveTrustedProviderBaseUrl(
        withRelations.code,
        withRelations.environment,
      ),
      timeoutMs: withRelations.settings?.timeoutMs ?? 30000,
      connectTimeoutMs: withRelations.settings?.connectTimeoutMs ?? 10000,
      maxRetries: withRelations.settings?.maxRetries ?? 2,
      retryDelayMs: withRelations.settings?.retryDelayMs ?? 1000,
      capabilities: withRelations.capabilities.map((item) => item.capability),
      services: withRelations.services
        .filter((item) => item.enabled)
        .map((item) => ({
          id: item.id,
          code: item.code,
          name: item.name,
          serviceType: item.serviceType,
          enabled: item.enabled,
          priority: item.priority,
        })),
      credentials,
    };
  }
}

export const providerConfigResolver = new ProviderConfigResolver();
