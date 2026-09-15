import type {
  AdminAuditLog,
  PackageType,
  Prisma,
  Provider,
  ProviderCapability,
  ProviderCapabilityRecord,
  ProviderCredential,
  ProviderCredentialField,
  ProviderEnvironment,
  ProviderIntegrationStatus,
  ProviderPackageLimits,
  ProviderService,
  ProviderSettings,
  ProviderVehicle,
} from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";
import { getPrismaClient } from "../../config/database.js";
import type { CreateAuditInput } from "./provider.types.js";
import { decimalToNumber } from "../delivery/delivery.types.js";

export type ProviderDbClient =
  | Prisma.TransactionClient
  | ReturnType<typeof getPrismaClient>;

const providerInclude = {
  settings: true,
  packageLimits: true,
  credentials: { where: { isActive: true } },
  capabilities: true,
  services: { orderBy: { priority: "asc" as const } },
  vehicles: true,
} as const;

export type ProviderWithRelations = Provider & {
  settings: ProviderSettings | null;
  packageLimits: ProviderPackageLimits | null;
  credentials: ProviderCredential[];
  capabilities: ProviderCapabilityRecord[];
  services: ProviderService[];
  vehicles: ProviderVehicle[];
};

export interface IProviderRepository {
  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
  createAudit(input: CreateAuditInput, client?: ProviderDbClient): Promise<AdminAuditLog>;
  findById(providerId: string): Promise<ProviderWithRelations | null>;
  findByCode(code: string): Promise<Provider | null>;
  listProviders(): Promise<ProviderWithRelations[]>;
  createProvider(
    data: {
      code: string;
      name: string;
      displayName: string | null;
      description: string | null;
      environment: ProviderEnvironment;
      enabled: boolean;
      orchestrationEnabled: boolean;
      priority: number;
      integrationStatus: ProviderIntegrationStatus;
      settings: Omit<ProviderSettings, "id" | "providerId" | "createdAt" | "updatedAt">;
      packageLimits?: {
        minWeightKg: number | null;
        maxWeightKg: number | null;
        maxLengthCm: number | null;
        maxWidthCm: number | null;
        maxHeightCm: number | null;
        maxVolumeCm3: number | null;
        supportedPackageTypes: PackageType[];
      } | null;
      capabilities: ProviderCapability[];
    },
    client?: ProviderDbClient,
  ): Promise<ProviderWithRelations>;
  updateProvider(
    providerId: string,
    data: Prisma.ProviderUpdateInput,
    client?: ProviderDbClient,
  ): Promise<ProviderWithRelations>;
  updateSettings(
    providerId: string,
    data: Partial<
      Omit<ProviderSettings, "id" | "providerId" | "createdAt" | "updatedAt">
    >,
    client?: ProviderDbClient,
  ): Promise<void>;
  upsertPackageLimits(
    providerId: string,
    data: {
      minWeightKg: number | null;
      maxWeightKg: number | null;
      maxLengthCm: number | null;
      maxWidthCm: number | null;
      maxHeightCm: number | null;
      maxVolumeCm3: number | null;
      supportedPackageTypes: PackageType[];
    } | null,
    client?: ProviderDbClient,
  ): Promise<void>;
  replaceCapabilities(
    providerId: string,
    capabilities: ProviderCapability[],
    client?: ProviderDbClient,
  ): Promise<void>;
  deactivateCredentials(
    providerId: string,
    fields: ProviderCredentialField[],
    client?: ProviderDbClient,
  ): Promise<void>;
  createCredential(
    data: {
      providerId: string;
      fieldName: ProviderCredentialField;
      ciphertext: string;
      iv: string;
      authTag: string;
    },
    client?: ProviderDbClient,
  ): Promise<ProviderCredential>;
  createService(
    data: Omit<ProviderService, "id" | "createdAt" | "updatedAt">,
    client?: ProviderDbClient,
  ): Promise<ProviderService>;
  updateService(
    serviceId: string,
    data: Prisma.ProviderServiceUpdateInput,
    client?: ProviderDbClient,
  ): Promise<ProviderService>;
  findService(providerId: string, serviceId: string): Promise<ProviderService | null>;
  listServices(providerId: string): Promise<ProviderService[]>;
  createVehicle(
    data: Omit<ProviderVehicle, "id" | "createdAt" | "updatedAt">,
    client?: ProviderDbClient,
  ): Promise<ProviderVehicle>;
  updateVehicle(
    vehicleId: string,
    data: Prisma.ProviderVehicleUpdateInput,
    client?: ProviderDbClient,
  ): Promise<ProviderVehicle>;
  findVehicle(providerId: string, vehicleId: string): Promise<ProviderVehicle | null>;
  listVehicles(providerId: string): Promise<ProviderVehicle[]>;
}

function toDecimal(value: number | null | undefined): PrismaNamespace.Decimal | null {
  if (value == null) return null;
  return new PrismaNamespace.Decimal(value);
}

export class PrismaProviderRepository implements IProviderRepository {
  private db(client?: ProviderDbClient) {
    return client ?? getPrismaClient();
  }

  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return getPrismaClient().$transaction(fn);
  }

  createAudit(input: CreateAuditInput, client?: ProviderDbClient): Promise<AdminAuditLog> {
    return this.db(client).adminAuditLog.create({
      data: {
        adminUserId: input.adminUserId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        requestId: input.requestId,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  findById(providerId: string): Promise<ProviderWithRelations | null> {
    return getPrismaClient().provider.findUnique({
      where: { id: providerId },
      include: providerInclude,
    }) as Promise<ProviderWithRelations | null>;
  }

  findByCode(code: string): Promise<Provider | null> {
    return getPrismaClient().provider.findUnique({ where: { code } });
  }

  listProviders(): Promise<ProviderWithRelations[]> {
    return getPrismaClient().provider.findMany({
      include: providerInclude,
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
    }) as Promise<ProviderWithRelations[]>;
  }

  async createProvider(
    data: Parameters<IProviderRepository["createProvider"]>[0],
    client?: ProviderDbClient,
  ): Promise<ProviderWithRelations> {
    const db = this.db(client);
    return db.provider.create({
      data: {
        code: data.code,
        name: data.name,
        displayName: data.displayName,
        description: data.description,
        environment: data.environment,
        enabled: data.enabled,
        orchestrationEnabled: data.orchestrationEnabled,
        priority: data.priority,
        integrationStatus: data.integrationStatus,
        status: data.enabled ? "ACTIVE" : "INACTIVE",
        settings: { create: data.settings },
        packageLimits: data.packageLimits
          ? {
              create: {
                minWeightKg: toDecimal(data.packageLimits.minWeightKg),
                maxWeightKg: toDecimal(data.packageLimits.maxWeightKg),
                maxLengthCm: toDecimal(data.packageLimits.maxLengthCm),
                maxWidthCm: toDecimal(data.packageLimits.maxWidthCm),
                maxHeightCm: toDecimal(data.packageLimits.maxHeightCm),
                maxVolumeCm3: toDecimal(data.packageLimits.maxVolumeCm3),
                supportedPackageTypes: data.packageLimits.supportedPackageTypes,
              },
            }
          : undefined,
        capabilities: {
          create: data.capabilities.map((capability) => ({ capability })),
        },
      },
      include: providerInclude,
    }) as Promise<ProviderWithRelations>;
  }

  async updateProvider(
    providerId: string,
    data: Prisma.ProviderUpdateInput,
    client?: ProviderDbClient,
  ): Promise<ProviderWithRelations> {
    return this.db(client).provider.update({
      where: { id: providerId },
      data,
      include: providerInclude,
    }) as Promise<ProviderWithRelations>;
  }

  async updateSettings(
    providerId: string,
    data: Partial<
      Omit<ProviderSettings, "id" | "providerId" | "createdAt" | "updatedAt">
    >,
    client?: ProviderDbClient,
  ): Promise<void> {
    await this.db(client).providerSettings.update({
      where: { providerId },
      data,
    });
  }

  async upsertPackageLimits(
    providerId: string,
    data: {
      minWeightKg: number | null;
      maxWeightKg: number | null;
      maxLengthCm: number | null;
      maxWidthCm: number | null;
      maxHeightCm: number | null;
      maxVolumeCm3: number | null;
      supportedPackageTypes: PackageType[];
    } | null,
    client?: ProviderDbClient,
  ): Promise<void> {
    const db = this.db(client);
    if (data === null) {
      await db.providerPackageLimits.deleteMany({ where: { providerId } });
      return;
    }
    await db.providerPackageLimits.upsert({
      where: { providerId },
      create: {
        providerId,
        minWeightKg: toDecimal(data.minWeightKg),
        maxWeightKg: toDecimal(data.maxWeightKg),
        maxLengthCm: toDecimal(data.maxLengthCm),
        maxWidthCm: toDecimal(data.maxWidthCm),
        maxHeightCm: toDecimal(data.maxHeightCm),
        maxVolumeCm3: toDecimal(data.maxVolumeCm3),
        supportedPackageTypes: data.supportedPackageTypes,
      },
      update: {
        minWeightKg: toDecimal(data.minWeightKg),
        maxWeightKg: toDecimal(data.maxWeightKg),
        maxLengthCm: toDecimal(data.maxLengthCm),
        maxWidthCm: toDecimal(data.maxWidthCm),
        maxHeightCm: toDecimal(data.maxHeightCm),
        maxVolumeCm3: toDecimal(data.maxVolumeCm3),
        supportedPackageTypes: data.supportedPackageTypes,
      },
    });
  }

  async replaceCapabilities(
    providerId: string,
    capabilities: ProviderCapability[],
    client?: ProviderDbClient,
  ): Promise<void> {
    const db = this.db(client);
    await db.providerCapabilityRecord.deleteMany({ where: { providerId } });
    if (capabilities.length > 0) {
      await db.providerCapabilityRecord.createMany({
        data: capabilities.map((capability) => ({ providerId, capability })),
      });
    }
  }

  async deactivateCredentials(
    providerId: string,
    fields: ProviderCredentialField[],
    client?: ProviderDbClient,
  ): Promise<void> {
    if (fields.length === 0) return;
    await this.db(client).providerCredential.updateMany({
      where: { providerId, fieldName: { in: fields }, isActive: true },
      data: { isActive: false },
    });
  }

  createCredential(
    data: {
      providerId: string;
      fieldName: ProviderCredentialField;
      ciphertext: string;
      iv: string;
      authTag: string;
    },
    client?: ProviderDbClient,
  ): Promise<ProviderCredential> {
    return this.db(client).providerCredential.create({ data });
  }

  createService(
    data: Omit<ProviderService, "id" | "createdAt" | "updatedAt">,
    client?: ProviderDbClient,
  ): Promise<ProviderService> {
    return this.db(client).providerService.create({ data });
  }

  updateService(
    serviceId: string,
    data: Prisma.ProviderServiceUpdateInput,
    client?: ProviderDbClient,
  ): Promise<ProviderService> {
    return this.db(client).providerService.update({ where: { id: serviceId }, data });
  }

  findService(providerId: string, serviceId: string): Promise<ProviderService | null> {
    return getPrismaClient().providerService.findFirst({
      where: { id: serviceId, providerId },
    });
  }

  listServices(providerId: string): Promise<ProviderService[]> {
    return getPrismaClient().providerService.findMany({
      where: { providerId },
      orderBy: { priority: "asc" },
    });
  }

  createVehicle(
    data: Omit<ProviderVehicle, "id" | "createdAt" | "updatedAt">,
    client?: ProviderDbClient,
  ): Promise<ProviderVehicle> {
    return this.db(client).providerVehicle.create({ data });
  }

  updateVehicle(
    vehicleId: string,
    data: Prisma.ProviderVehicleUpdateInput,
    client?: ProviderDbClient,
  ): Promise<ProviderVehicle> {
    return this.db(client).providerVehicle.update({ where: { id: vehicleId }, data });
  }

  findVehicle(providerId: string, vehicleId: string): Promise<ProviderVehicle | null> {
    return getPrismaClient().providerVehicle.findFirst({
      where: { id: vehicleId, providerId },
    });
  }

  listVehicles(providerId: string): Promise<ProviderVehicle[]> {
    return getPrismaClient().providerVehicle.findMany({ where: { providerId } });
  }
}

export const providerRepository = new PrismaProviderRepository();

export function mapPackageLimits(
  limits: ProviderPackageLimits | null,
): import("./provider.types.js").ProviderPackageLimitsDto | null {
  if (!limits) return null;
  return {
    minWeightKg: limits.minWeightKg == null ? null : decimalToNumber(limits.minWeightKg),
    maxWeightKg: limits.maxWeightKg == null ? null : decimalToNumber(limits.maxWeightKg),
    maxLengthCm: limits.maxLengthCm == null ? null : decimalToNumber(limits.maxLengthCm),
    maxWidthCm: limits.maxWidthCm == null ? null : decimalToNumber(limits.maxWidthCm),
    maxHeightCm: limits.maxHeightCm == null ? null : decimalToNumber(limits.maxHeightCm),
    maxVolumeCm3:
      limits.maxVolumeCm3 == null ? null : decimalToNumber(limits.maxVolumeCm3),
    supportedPackageTypes: limits.supportedPackageTypes,
  };
}

export function mapSettings(
  settings: ProviderSettings | null,
): import("./provider.types.js").ProviderSettingsDto {
  return {
    timeoutMs: settings?.timeoutMs ?? 30000,
    connectTimeoutMs: settings?.connectTimeoutMs ?? 10000,
    maxRetries: settings?.maxRetries ?? 2,
    retryDelayMs: settings?.retryDelayMs ?? 1000,
    webhookEnabled: settings?.webhookEnabled ?? false,
    healthCheckEnabled: settings?.healthCheckEnabled ?? true,
    healthCheckIntervalMs: settings?.healthCheckIntervalMs ?? 300000,
  };
}
