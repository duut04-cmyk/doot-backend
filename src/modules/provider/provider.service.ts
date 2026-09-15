import type { PackageType, ProviderCredentialField } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";
import { logger } from "../../config/logger.js";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import { encryptCredential } from "./provider.crypto.js";
import {
  toProviderDetailDto,
  toProviderSummaryDto,
} from "./provider.mapper.js";
import { computeIntegrationStatus } from "./provider.readiness.js";
import {
  providerRepository,
  type IProviderRepository,
  type ProviderWithRelations,
} from "./provider.repository.js";
import type {
  CreateProviderBody,
  CreateProviderServiceBody,
  CreateProviderVehicleBody,
  ReplaceCapabilitiesBody,
  UpdateProviderBody,
  UpdateProviderServiceBody,
  UpdateProviderStatusBody,
  UpdateProviderVehicleBody,
  UpsertCredentialsBody,
} from "./provider.schema.js";
import { PROVIDER_CREDENTIAL_FIELD_VALUES } from "./provider.schema.js";
import type {
  AuditContext,
  ProviderDetailDto,
  ProviderServiceDto,
  ProviderSummaryDto,
  ProviderVehicleDto,
  SafeAuditMetadata,
} from "./provider.types.js";

type PackageLimitsInput = {
  minWeightKg?: number | null;
  maxWeightKg?: number | null;
  maxLengthCm?: number | null;
  maxWidthCm?: number | null;
  maxHeightCm?: number | null;
  maxVolumeCm3?: number | null;
  supportedPackageTypes?: PackageType[];
};

function normalizePackageLimits(input?: PackageLimitsInput | null) {
  if (input == null) return null;
  return {
    minWeightKg: input.minWeightKg ?? null,
    maxWeightKg: input.maxWeightKg ?? null,
    maxLengthCm: input.maxLengthCm ?? null,
    maxWidthCm: input.maxWidthCm ?? null,
    maxHeightCm: input.maxHeightCm ?? null,
    maxVolumeCm3: input.maxVolumeCm3 ?? null,
    supportedPackageTypes: input.supportedPackageTypes ?? [],
  };
}

function toDecimal(value: number | null): PrismaNamespace.Decimal | null {
  if (value == null) return null;
  return new PrismaNamespace.Decimal(value);
}

const DEFAULT_SETTINGS = {
  timeoutMs: 30000,
  connectTimeoutMs: 10000,
  maxRetries: 2,
  retryDelayMs: 1000,
  webhookEnabled: false,
  healthCheckEnabled: true,
  healthCheckIntervalMs: 300000,
} as const;

function mapVehicleDto(
  vehicle: ProviderWithRelations["vehicles"][number],
): ProviderVehicleDto {
  return {
    id: vehicle.id,
    vehicleType: vehicle.vehicleType,
    enabled: vehicle.enabled,
    maxWeightKg:
      vehicle.maxWeightKg == null ? null : Number(vehicle.maxWeightKg),
    maxLengthCm:
      vehicle.maxLengthCm == null ? null : Number(vehicle.maxLengthCm),
    maxWidthCm: vehicle.maxWidthCm == null ? null : Number(vehicle.maxWidthCm),
    maxHeightCm:
      vehicle.maxHeightCm == null ? null : Number(vehicle.maxHeightCm),
    createdAt: vehicle.createdAt.toISOString(),
    updatedAt: vehicle.updatedAt.toISOString(),
  };
}

function mapServiceDto(
  service: ProviderWithRelations["services"][number],
): ProviderServiceDto {
  return {
    id: service.id,
    code: service.code,
    name: service.name,
    serviceType: service.serviceType,
    description: service.description,
    enabled: service.enabled,
    priority: service.priority,
    createdAt: service.createdAt.toISOString(),
    updatedAt: service.updatedAt.toISOString(),
  };
}

export class ProviderService {
  constructor(
    private readonly repository: IProviderRepository = providerRepository,
  ) {}

  async createProvider(input: {
    body: CreateProviderBody;
    audit: AuditContext;
  }): Promise<{ success: true; data: ProviderDetailDto }> {
    const existing = await this.repository.findByCode(input.body.code);
    if (existing) {
      throw new AppError("A provider with this code already exists.", {
        statusCode: 409,
        code: ErrorCodes.PROVIDER_CODE_ALREADY_EXISTS,
      });
    }

    const settings = { ...DEFAULT_SETTINGS, ...input.body.settings };
    const provider = await this.repository.createProvider({
      code: input.body.code,
      name: input.body.name,
      displayName: input.body.displayName ?? null,
      description: input.body.description ?? null,
      environment: input.body.environment,
      enabled: input.body.enabled,
      orchestrationEnabled: input.body.orchestrationEnabled,
      priority: input.body.priority ?? 100,
      integrationStatus: "NOT_CONFIGURED",
      settings,
      packageLimits: normalizePackageLimits(input.body.packageLimits),
      capabilities: input.body.capabilities,
    });

    const refreshed = await this.refreshIntegrationStatus(provider.id);
    await this.audit({
      ...input.audit,
      action: "PROVIDER_CREATED",
      resourceType: "PROVIDER",
      resourceId: refreshed.id,
      metadata: {
        code: refreshed.code,
        enabled: refreshed.enabled,
        environment: refreshed.environment,
      },
    });

    logger.info(
      { providerId: refreshed.id, code: refreshed.code },
      "provider_created",
    );

    return { success: true, data: toProviderDetailDto(refreshed) };
  }

  async listProviders(): Promise<{ success: true; data: ProviderSummaryDto[] }> {
    const providers = await this.repository.listProviders();
    return {
      success: true,
      data: providers.map(toProviderSummaryDto),
    };
  }

  async getProvider(providerId: string): Promise<{ success: true; data: ProviderDetailDto }> {
    const provider = await this.requireProvider(providerId);
    return { success: true, data: toProviderDetailDto(provider) };
  }

  async updateProvider(input: {
    providerId: string;
    body: UpdateProviderBody;
    audit: AuditContext;
  }): Promise<{ success: true; data: ProviderDetailDto }> {
    const existing = await this.requireProvider(input.providerId);
    const changes: SafeAuditMetadata = {};

    if (input.body.name !== undefined) changes.name = input.body.name;
    if (input.body.displayName !== undefined) {
      changes.displayName = input.body.displayName;
    }
    if (input.body.description !== undefined) {
      changes.description = input.body.description;
    }
    if (input.body.environment !== undefined) {
      changes.environment = input.body.environment;
    }
    if (input.body.priority !== undefined) {
      changes.priority = { from: existing.priority, to: input.body.priority };
    }
    if (input.body.orchestrationEnabled !== undefined) {
      changes.orchestrationEnabled = {
        from: existing.orchestrationEnabled,
        to: input.body.orchestrationEnabled,
      };
    }

    const updateData: Parameters<IProviderRepository["updateProvider"]>[1] = {};
    if (input.body.name !== undefined) updateData.name = input.body.name;
    if (input.body.displayName !== undefined) {
      updateData.displayName = input.body.displayName;
    }
    if (input.body.description !== undefined) {
      updateData.description = input.body.description;
    }
    if (input.body.environment !== undefined) {
      updateData.environment = input.body.environment;
    }
    if (input.body.orchestrationEnabled !== undefined) {
      updateData.orchestrationEnabled = input.body.orchestrationEnabled;
    }
    if (input.body.priority !== undefined) {
      updateData.priority = input.body.priority;
    }

    if (input.body.enabled !== undefined) {
      changes.enabled = { from: existing.enabled, to: input.body.enabled };
      updateData.enabled = input.body.enabled;
      updateData.status = input.body.enabled ? "ACTIVE" : "INACTIVE";
    }

    await this.repository.withTransaction(async (tx) => {
      if (Object.keys(updateData).length > 0) {
        await this.repository.updateProvider(input.providerId, updateData, tx);
      }
      if (input.body.settings) {
        await this.repository.updateSettings(
          input.providerId,
          input.body.settings,
          tx,
        );
        changes.settings = Object.keys(input.body.settings);
      }
      if (input.body.packageLimits !== undefined) {
        await this.repository.upsertPackageLimits(
          input.providerId,
          normalizePackageLimits(input.body.packageLimits),
          tx,
        );
        changes.packageLimits = input.body.packageLimits === null ? "cleared" : "updated";
      }
    });

    const refreshed = await this.refreshIntegrationStatus(input.providerId);

    if (input.body.enabled !== undefined && input.body.enabled !== existing.enabled) {
      await this.audit({
        ...input.audit,
        action: input.body.enabled ? "PROVIDER_ENABLED" : "PROVIDER_DISABLED",
        resourceType: "PROVIDER",
        resourceId: refreshed.id,
        metadata: { enabled: input.body.enabled },
      });
    }

    await this.audit({
      ...input.audit,
      action: "PROVIDER_UPDATED",
      resourceType: "PROVIDER",
      resourceId: refreshed.id,
      metadata: changes,
    });

    return { success: true, data: toProviderDetailDto(refreshed) };
  }

  async updateProviderStatus(input: {
    providerId: string;
    body: UpdateProviderStatusBody;
    audit: AuditContext;
  }): Promise<{ success: true; data: ProviderDetailDto }> {
    const existing = await this.requireProvider(input.providerId);
    const enabled =
      input.body.enabled ??
      (input.body.status === "ACTIVE"
        ? true
        : input.body.status === "INACTIVE"
          ? false
          : existing.enabled);

    const provider = await this.repository.updateProvider(input.providerId, {
      status: input.body.status,
      enabled,
    });

    const refreshed = await this.refreshIntegrationStatus(provider.id);

    await this.audit({
      ...input.audit,
      action: "PROVIDER_STATUS_CHANGED",
      resourceType: "PROVIDER",
      resourceId: refreshed.id,
      metadata: {
        status: { from: existing.status, to: input.body.status },
        enabled: { from: existing.enabled, to: refreshed.enabled },
      },
    });

    if (refreshed.enabled !== existing.enabled) {
      await this.audit({
        ...input.audit,
        action: refreshed.enabled ? "PROVIDER_ENABLED" : "PROVIDER_DISABLED",
        resourceType: "PROVIDER",
        resourceId: refreshed.id,
        metadata: { enabled: refreshed.enabled },
      });
    }

    return { success: true, data: toProviderDetailDto(refreshed) };
  }

  async upsertCredentials(input: {
    providerId: string;
    body: UpsertCredentialsBody;
    audit: AuditContext;
  }): Promise<{ success: true; data: { configured: boolean } }> {
    await this.requireProvider(input.providerId);

    const fields = Object.entries(input.body).filter(
      (entry): entry is [ProviderCredentialField, string] =>
        entry[1] !== undefined &&
        PROVIDER_CREDENTIAL_FIELD_VALUES.includes(
          entry[0] as ProviderCredentialField,
        ),
    );

    if (fields.length === 0) {
      throw new AppError("At least one credential field is required.", {
        statusCode: 400,
        code: ErrorCodes.PROVIDER_CREDENTIALS_INVALID,
      });
    }

    const fieldNames = fields.map(([name]) => name);

    await this.repository.withTransaction(async (tx) => {
      await this.repository.deactivateCredentials(
        input.providerId,
        fieldNames,
        tx,
      );
      for (const [fieldName, value] of fields) {
        const encrypted = encryptCredential(value);
        await this.repository.createCredential(
          {
            providerId: input.providerId,
            fieldName,
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            authTag: encrypted.authTag,
          },
          tx,
        );
      }
    });

    await this.refreshIntegrationStatus(input.providerId);

    await this.audit({
      ...input.audit,
      action: "PROVIDER_CREDENTIALS_UPDATED",
      resourceType: "PROVIDER_CREDENTIALS",
      resourceId: input.providerId,
      metadata: { fields: fieldNames },
    });

    logger.info(
      { providerId: input.providerId, fields: fieldNames },
      "provider_credentials_updated",
    );

    return { success: true, data: { configured: true } };
  }

  async replaceCapabilities(input: {
    providerId: string;
    body: ReplaceCapabilitiesBody;
    audit: AuditContext;
  }): Promise<{ success: true; data: ProviderDetailDto }> {
    const existing = await this.requireProvider(input.providerId);

    await this.repository.replaceCapabilities(
      input.providerId,
      input.body.capabilities,
    );

    const refreshed = await this.refreshIntegrationStatus(input.providerId);

    await this.audit({
      ...input.audit,
      action: "PROVIDER_CAPABILITIES_UPDATED",
      resourceType: "PROVIDER_CAPABILITIES",
      resourceId: input.providerId,
      metadata: {
        from: existing.capabilities.map((item) => item.capability),
        to: input.body.capabilities,
      },
    });

    return { success: true, data: toProviderDetailDto(refreshed) };
  }

  async createService(input: {
    providerId: string;
    body: CreateProviderServiceBody;
    audit: AuditContext;
  }): Promise<{ success: true; data: ProviderServiceDto }> {
    await this.requireProvider(input.providerId);

    const services = await this.repository.listServices(input.providerId);
    if (services.some((item) => item.code === input.body.code)) {
      throw new AppError("A service with this code already exists for the provider.", {
        statusCode: 409,
        code: ErrorCodes.CONFLICT,
      });
    }

    const service = await this.repository.createService({
      providerId: input.providerId,
      code: input.body.code,
      name: input.body.name,
      serviceType: input.body.serviceType,
      description: input.body.description ?? null,
      enabled: input.body.enabled ?? true,
      priority: input.body.priority ?? 100,
    });

    await this.audit({
      ...input.audit,
      action: "PROVIDER_SERVICE_CREATED",
      resourceType: "PROVIDER_SERVICE",
      resourceId: service.id,
      metadata: { code: service.code, serviceType: service.serviceType },
    });

    return { success: true, data: mapServiceDto(service) };
  }

  async listServices(
    providerId: string,
  ): Promise<{ success: true; data: ProviderServiceDto[] }> {
    await this.requireProvider(providerId);
    const services = await this.repository.listServices(providerId);
    return { success: true, data: services.map(mapServiceDto) };
  }

  async updateService(input: {
    providerId: string;
    serviceId: string;
    body: UpdateProviderServiceBody;
    audit: AuditContext;
  }): Promise<{ success: true; data: ProviderServiceDto }> {
    const service = await this.repository.findService(
      input.providerId,
      input.serviceId,
    );
    if (!service) {
      throw new AppError("Provider service not found.", {
        statusCode: 404,
        code: ErrorCodes.PROVIDER_SERVICE_NOT_FOUND,
      });
    }

    const updated = await this.repository.updateService(input.serviceId, {
      ...(input.body.name !== undefined ? { name: input.body.name } : {}),
      ...(input.body.serviceType !== undefined
        ? { serviceType: input.body.serviceType }
        : {}),
      ...(input.body.description !== undefined
        ? { description: input.body.description }
        : {}),
      ...(input.body.enabled !== undefined ? { enabled: input.body.enabled } : {}),
      ...(input.body.priority !== undefined ? { priority: input.body.priority } : {}),
    });

    await this.audit({
      ...input.audit,
      action:
        input.body.enabled === false && service.enabled
          ? "PROVIDER_SERVICE_DISABLED"
          : "PROVIDER_SERVICE_UPDATED",
      resourceType: "PROVIDER_SERVICE",
      resourceId: updated.id,
      metadata: {
        code: updated.code,
        ...(input.body.enabled !== undefined
          ? { enabled: { from: service.enabled, to: input.body.enabled } }
          : {}),
      },
    });

    return { success: true, data: mapServiceDto(updated) };
  }

  async createVehicle(input: {
    providerId: string;
    body: CreateProviderVehicleBody;
    audit: AuditContext;
  }): Promise<{ success: true; data: ProviderVehicleDto }> {
    await this.requireProvider(input.providerId);

    const vehicles = await this.repository.listVehicles(input.providerId);
    if (vehicles.some((item) => item.vehicleType === input.body.vehicleType)) {
      throw new AppError("This vehicle type is already configured for the provider.", {
        statusCode: 409,
        code: ErrorCodes.CONFLICT,
      });
    }

    const vehicle = await this.repository.createVehicle({
      providerId: input.providerId,
      vehicleType: input.body.vehicleType,
      enabled: input.body.enabled ?? true,
      maxWeightKg: toDecimal(input.body.maxWeightKg ?? null),
      maxLengthCm: toDecimal(input.body.maxLengthCm ?? null),
      maxWidthCm: toDecimal(input.body.maxWidthCm ?? null),
      maxHeightCm: toDecimal(input.body.maxHeightCm ?? null),
    });

    await this.audit({
      ...input.audit,
      action: "PROVIDER_VEHICLE_CREATED",
      resourceType: "PROVIDER_VEHICLE",
      resourceId: vehicle.id,
      metadata: { vehicleType: vehicle.vehicleType },
    });

    return { success: true, data: mapVehicleDto(vehicle) };
  }

  async listVehicles(
    providerId: string,
  ): Promise<{ success: true; data: ProviderVehicleDto[] }> {
    await this.requireProvider(providerId);
    const vehicles = await this.repository.listVehicles(providerId);
    return { success: true, data: vehicles.map(mapVehicleDto) };
  }

  async updateVehicle(input: {
    providerId: string;
    vehicleId: string;
    body: UpdateProviderVehicleBody;
    audit: AuditContext;
  }): Promise<{ success: true; data: ProviderVehicleDto }> {
    const vehicle = await this.repository.findVehicle(
      input.providerId,
      input.vehicleId,
    );
    if (!vehicle) {
      throw new AppError("Provider vehicle not found.", {
        statusCode: 404,
        code: ErrorCodes.PROVIDER_VEHICLE_NOT_FOUND,
      });
    }

    const updated = await this.repository.updateVehicle(input.vehicleId, {
      ...(input.body.enabled !== undefined ? { enabled: input.body.enabled } : {}),
      ...(input.body.maxWeightKg !== undefined
        ? { maxWeightKg: input.body.maxWeightKg }
        : {}),
      ...(input.body.maxLengthCm !== undefined
        ? { maxLengthCm: input.body.maxLengthCm }
        : {}),
      ...(input.body.maxWidthCm !== undefined
        ? { maxWidthCm: input.body.maxWidthCm }
        : {}),
      ...(input.body.maxHeightCm !== undefined
        ? { maxHeightCm: input.body.maxHeightCm }
        : {}),
    });

    await this.audit({
      ...input.audit,
      action: "PROVIDER_VEHICLE_UPDATED",
      resourceType: "PROVIDER_VEHICLE",
      resourceId: updated.id,
      metadata: { vehicleType: updated.vehicleType },
    });

    return { success: true, data: mapVehicleDto(updated) };
  }

  private async requireProvider(providerId: string): Promise<ProviderWithRelations> {
    const provider = await this.repository.findById(providerId);
    if (!provider) {
      throw new AppError("Provider not found.", {
        statusCode: 404,
        code: ErrorCodes.PROVIDER_NOT_FOUND,
      });
    }
    return provider;
  }

  private async refreshIntegrationStatus(
    providerId: string,
  ): Promise<ProviderWithRelations> {
    const provider = await this.requireProvider(providerId);
    const integrationStatus = computeIntegrationStatus({
      provider,
      activeCredentials: provider.credentials,
      capabilities: provider.capabilities,
    });

    if (provider.integrationStatus === integrationStatus) {
      return provider;
    }

    return this.repository.updateProvider(providerId, { integrationStatus });
  }

  private audit(input: CreateAuditInput): Promise<unknown> {
    return this.repository.createAudit(input);
  }
}

type CreateAuditInput = Parameters<IProviderRepository["createAudit"]>[0];

export const providerService = new ProviderService();
