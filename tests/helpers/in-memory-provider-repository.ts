import { randomUUID } from "node:crypto";
import type {
  AdminAuditLog,
  PackageType,
  Prisma,
  Provider,
  ProviderCapability,
  ProviderCredential,
  ProviderCredentialField,
  ProviderService,
  ProviderVehicle,
} from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";
import type {
  IProviderRepository,
  ProviderWithRelations,
} from "../../src/modules/provider/provider.repository.js";
import type { CreateAuditInput } from "../../src/modules/provider/provider.types.js";

function toDecimal(value: number | null | undefined): PrismaNamespace.Decimal | null {
  if (value == null) return null;
  return new PrismaNamespace.Decimal(value);
}

export class InMemoryProviderRepository implements IProviderRepository {
  providers: ProviderWithRelations[] = [];
  auditLogs: AdminAuditLog[] = [];

  async withTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const providerSnap = this.providers.map((item) => this.cloneProvider(item));
    const auditSnap = this.auditLogs.map((item) => ({ ...item }));
    try {
      return await fn({} as Prisma.TransactionClient);
    } catch (error) {
      this.providers = providerSnap;
      this.auditLogs = auditSnap;
      throw error;
    }
  }

  private cloneProvider(provider: ProviderWithRelations): ProviderWithRelations {
    return {
      ...provider,
      settings: provider.settings ? { ...provider.settings } : null,
      packageLimits: provider.packageLimits
        ? {
            ...provider.packageLimits,
            minWeightKg:
              provider.packageLimits.minWeightKg == null
                ? null
                : new PrismaNamespace.Decimal(provider.packageLimits.minWeightKg.toString()),
            maxWeightKg:
              provider.packageLimits.maxWeightKg == null
                ? null
                : new PrismaNamespace.Decimal(provider.packageLimits.maxWeightKg.toString()),
            maxLengthCm:
              provider.packageLimits.maxLengthCm == null
                ? null
                : new PrismaNamespace.Decimal(provider.packageLimits.maxLengthCm.toString()),
            maxWidthCm:
              provider.packageLimits.maxWidthCm == null
                ? null
                : new PrismaNamespace.Decimal(provider.packageLimits.maxWidthCm.toString()),
            maxHeightCm:
              provider.packageLimits.maxHeightCm == null
                ? null
                : new PrismaNamespace.Decimal(provider.packageLimits.maxHeightCm.toString()),
            maxVolumeCm3:
              provider.packageLimits.maxVolumeCm3 == null
                ? null
                : new PrismaNamespace.Decimal(provider.packageLimits.maxVolumeCm3.toString()),
          }
        : null,
      credentials: provider.credentials.map((item) => ({ ...item })),
      capabilities: provider.capabilities.map((item) => ({ ...item })),
      services: provider.services.map((item) => ({ ...item })),
      vehicles: provider.vehicles.map((item) => ({
        ...item,
        maxWeightKg:
          item.maxWeightKg == null
            ? null
            : new PrismaNamespace.Decimal(item.maxWeightKg.toString()),
        maxLengthCm:
          item.maxLengthCm == null
            ? null
            : new PrismaNamespace.Decimal(item.maxLengthCm.toString()),
        maxWidthCm:
          item.maxWidthCm == null
            ? null
            : new PrismaNamespace.Decimal(item.maxWidthCm.toString()),
        maxHeightCm:
          item.maxHeightCm == null
            ? null
            : new PrismaNamespace.Decimal(item.maxHeightCm.toString()),
      })),
    };
  }

  createAudit(input: CreateAuditInput): Promise<AdminAuditLog> {
    const log: AdminAuditLog = {
      id: randomUUID(),
      adminUserId: input.adminUserId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      requestId: input.requestId,
      metadata: input.metadata ?? null,
      createdAt: new Date(),
    };
    this.auditLogs.push(log);
    return Promise.resolve(log);
  }

  private withActiveCredentials(
    provider: ProviderWithRelations,
  ): ProviderWithRelations {
    return {
      ...provider,
      credentials: provider.credentials.filter((item) => item.isActive),
    };
  }

  findById(providerId: string): Promise<ProviderWithRelations | null> {
    const provider = this.providers.find((item) => item.id === providerId);
    return Promise.resolve(provider ? this.withActiveCredentials(provider) : null);
  }

  findByCode(code: string): Promise<Provider | null> {
    const provider = this.providers.find((item) => item.code === code);
    return Promise.resolve(provider ?? null);
  }

  listProviders(): Promise<ProviderWithRelations[]> {
    return Promise.resolve(
      [...this.providers]
        .sort((a, b) => {
          if (a.priority !== b.priority) return a.priority - b.priority;
          return b.createdAt.getTime() - a.createdAt.getTime();
        })
        .map((item) => this.withActiveCredentials(item)),
    );
  }

  async createProvider(
    data: Parameters<IProviderRepository["createProvider"]>[0],
  ): Promise<ProviderWithRelations> {
    const now = new Date();
    const providerId = randomUUID();
    const provider: ProviderWithRelations = {
      id: providerId,
      code: data.code,
      name: data.name,
      displayName: data.displayName,
      description: data.description,
      status: data.enabled ? "ACTIVE" : "INACTIVE",
      environment: data.environment,
      enabled: data.enabled,
      orchestrationEnabled: data.orchestrationEnabled,
      priority: data.priority,
      integrationStatus: data.integrationStatus,
      healthStatus: "UNKNOWN",
      lastHealthCheckAt: null,
      lastHealthCheckError: null,
      createdAt: now,
      updatedAt: now,
      settings: {
        id: randomUUID(),
        providerId,
        timeoutMs: data.settings.timeoutMs,
        connectTimeoutMs: data.settings.connectTimeoutMs,
        maxRetries: data.settings.maxRetries,
        retryDelayMs: data.settings.retryDelayMs,
        webhookEnabled: data.settings.webhookEnabled,
        healthCheckEnabled: data.settings.healthCheckEnabled,
        healthCheckIntervalMs: data.settings.healthCheckIntervalMs,
        createdAt: now,
        updatedAt: now,
      },
      packageLimits: data.packageLimits
        ? {
            id: randomUUID(),
            providerId,
            minWeightKg: toDecimal(data.packageLimits.minWeightKg),
            maxWeightKg: toDecimal(data.packageLimits.maxWeightKg),
            maxLengthCm: toDecimal(data.packageLimits.maxLengthCm),
            maxWidthCm: toDecimal(data.packageLimits.maxWidthCm),
            maxHeightCm: toDecimal(data.packageLimits.maxHeightCm),
            maxVolumeCm3: toDecimal(data.packageLimits.maxVolumeCm3),
            supportedPackageTypes: data.packageLimits.supportedPackageTypes,
            createdAt: now,
            updatedAt: now,
          }
        : null,
      credentials: [],
      capabilities: data.capabilities.map((capability) => ({
        id: randomUUID(),
        providerId,
        capability,
      })),
      services: [],
      vehicles: [],
    };
    this.providers.push(provider);
    return this.withActiveCredentials(provider);
  }

  async updateProvider(
    providerId: string,
    data: Prisma.ProviderUpdateInput,
  ): Promise<ProviderWithRelations> {
    const provider = this.providers.find((item) => item.id === providerId);
    if (!provider) {
      throw new Error("Provider not found");
    }
    if (typeof data.name === "string") provider.name = data.name;
    if (data.displayName !== undefined) {
      provider.displayName = data.displayName as string | null;
    }
    if (data.description !== undefined) {
      provider.description = data.description as string | null;
    }
    if (typeof data.environment === "string") {
      provider.environment = data.environment;
    }
    if (typeof data.enabled === "boolean") provider.enabled = data.enabled;
    if (typeof data.orchestrationEnabled === "boolean") {
      provider.orchestrationEnabled = data.orchestrationEnabled;
    }
    if (typeof data.priority === "number") provider.priority = data.priority;
    if (typeof data.status === "string") provider.status = data.status;
    if (typeof data.integrationStatus === "string") {
      provider.integrationStatus = data.integrationStatus;
    }
    provider.updatedAt = new Date();
    return this.withActiveCredentials(provider);
  }

  async updateSettings(
    providerId: string,
    data: Partial<NonNullable<ProviderWithRelations["settings"]>>,
  ): Promise<void> {
    const provider = this.providers.find((item) => item.id === providerId);
    if (!provider?.settings) return;
    Object.assign(provider.settings, data, { updatedAt: new Date() });
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
  ): Promise<void> {
    const provider = this.providers.find((item) => item.id === providerId);
    if (!provider) return;
    if (data === null) {
      provider.packageLimits = null;
      return;
    }
    const now = new Date();
    provider.packageLimits = {
      id: provider.packageLimits?.id ?? randomUUID(),
      providerId,
      minWeightKg: toDecimal(data.minWeightKg),
      maxWeightKg: toDecimal(data.maxWeightKg),
      maxLengthCm: toDecimal(data.maxLengthCm),
      maxWidthCm: toDecimal(data.maxWidthCm),
      maxHeightCm: toDecimal(data.maxHeightCm),
      maxVolumeCm3: toDecimal(data.maxVolumeCm3),
      supportedPackageTypes: data.supportedPackageTypes,
      createdAt: provider.packageLimits?.createdAt ?? now,
      updatedAt: now,
    };
  }

  async replaceCapabilities(
    providerId: string,
    capabilities: ProviderCapability[],
  ): Promise<void> {
    const provider = this.providers.find((item) => item.id === providerId);
    if (!provider) return;
    provider.capabilities = capabilities.map((capability) => ({
      id: randomUUID(),
      providerId,
      capability,
    }));
  }

  async deactivateCredentials(
    providerId: string,
    fields: ProviderCredentialField[],
  ): Promise<void> {
    const provider = this.providers.find((item) => item.id === providerId);
    if (!provider) return;
    for (const credential of provider.credentials) {
      if (fields.includes(credential.fieldName) && credential.isActive) {
        credential.isActive = false;
        credential.updatedAt = new Date();
      }
    }
  }

  createCredential(data: {
    providerId: string;
    fieldName: ProviderCredentialField;
    ciphertext: string;
    iv: string;
    authTag: string;
  }): Promise<ProviderCredential> {
    const provider = this.providers.find((item) => item.id === data.providerId);
    if (!provider) {
      throw new Error("Provider not found");
    }
    const now = new Date();
    const credential: ProviderCredential = {
      id: randomUUID(),
      providerId: data.providerId,
      fieldName: data.fieldName,
      ciphertext: data.ciphertext,
      iv: data.iv,
      authTag: data.authTag,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    provider.credentials.push(credential);
    return Promise.resolve(credential);
  }

  createService(
    data: Omit<ProviderService, "id" | "createdAt" | "updatedAt">,
  ): Promise<ProviderService> {
    const provider = this.providers.find((item) => item.id === data.providerId);
    if (!provider) {
      throw new Error("Provider not found");
    }
    const now = new Date();
    const service: ProviderService = {
      id: randomUUID(),
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    provider.services.push(service);
    return Promise.resolve(service);
  }

  updateService(
    serviceId: string,
    data: Prisma.ProviderServiceUpdateInput,
  ): Promise<ProviderService> {
    for (const provider of this.providers) {
      const service = provider.services.find((item) => item.id === serviceId);
      if (!service) continue;
      if (typeof data.name === "string") service.name = data.name;
      if (typeof data.serviceType === "string") service.serviceType = data.serviceType;
      if (data.description !== undefined) {
        service.description = data.description as string | null;
      }
      if (typeof data.enabled === "boolean") service.enabled = data.enabled;
      if (typeof data.priority === "number") service.priority = data.priority;
      service.updatedAt = new Date();
      return Promise.resolve(service);
    }
    throw new Error("Service not found");
  }

  findService(providerId: string, serviceId: string): Promise<ProviderService | null> {
    const provider = this.providers.find((item) => item.id === providerId);
    return Promise.resolve(
      provider?.services.find((item) => item.id === serviceId) ?? null,
    );
  }

  listServices(providerId: string): Promise<ProviderService[]> {
    const provider = this.providers.find((item) => item.id === providerId);
    return Promise.resolve(
      [...(provider?.services ?? [])].sort((a, b) => a.priority - b.priority),
    );
  }

  createVehicle(
    data: Omit<ProviderVehicle, "id" | "createdAt" | "updatedAt">,
  ): Promise<ProviderVehicle> {
    const provider = this.providers.find((item) => item.id === data.providerId);
    if (!provider) {
      throw new Error("Provider not found");
    }
    const now = new Date();
    const vehicle: ProviderVehicle = {
      id: randomUUID(),
      providerId: data.providerId,
      vehicleType: data.vehicleType,
      enabled: data.enabled,
      maxWeightKg: toDecimal(
        data.maxWeightKg == null ? null : Number(data.maxWeightKg),
      ),
      maxLengthCm: toDecimal(
        data.maxLengthCm == null ? null : Number(data.maxLengthCm),
      ),
      maxWidthCm: toDecimal(
        data.maxWidthCm == null ? null : Number(data.maxWidthCm),
      ),
      maxHeightCm: toDecimal(
        data.maxHeightCm == null ? null : Number(data.maxHeightCm),
      ),
      createdAt: now,
      updatedAt: now,
    };
    provider.vehicles.push(vehicle);
    return Promise.resolve(vehicle);
  }

  updateVehicle(
    vehicleId: string,
    data: Prisma.ProviderVehicleUpdateInput,
  ): Promise<ProviderVehicle> {
    for (const provider of this.providers) {
      const vehicle = provider.vehicles.find((item) => item.id === vehicleId);
      if (!vehicle) continue;
      if (typeof data.enabled === "boolean") vehicle.enabled = data.enabled;
      if (data.maxWeightKg !== undefined) {
        vehicle.maxWeightKg = toDecimal(
          data.maxWeightKg == null ? null : Number(data.maxWeightKg),
        );
      }
      if (data.maxLengthCm !== undefined) {
        vehicle.maxLengthCm = toDecimal(
          data.maxLengthCm == null ? null : Number(data.maxLengthCm),
        );
      }
      if (data.maxWidthCm !== undefined) {
        vehicle.maxWidthCm = toDecimal(
          data.maxWidthCm == null ? null : Number(data.maxWidthCm),
        );
      }
      if (data.maxHeightCm !== undefined) {
        vehicle.maxHeightCm = toDecimal(
          data.maxHeightCm == null ? null : Number(data.maxHeightCm),
        );
      }
      vehicle.updatedAt = new Date();
      return Promise.resolve(vehicle);
    }
    throw new Error("Vehicle not found");
  }

  findVehicle(providerId: string, vehicleId: string): Promise<ProviderVehicle | null> {
    const provider = this.providers.find((item) => item.id === providerId);
    return Promise.resolve(
      provider?.vehicles.find((item) => item.id === vehicleId) ?? null,
    );
  }

  listVehicles(providerId: string): Promise<ProviderVehicle[]> {
    const provider = this.providers.find((item) => item.id === providerId);
    return Promise.resolve(provider?.vehicles ?? []);
  }
}
