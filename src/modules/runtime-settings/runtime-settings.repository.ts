import type {
  AdminAuditLog,
  PlatformRuntimeSetting,
  PlatformRuntimeSettingKey,
  Prisma,
} from "@prisma/client";
import { getPrismaClient } from "../../config/database.js";
import type { CreateAuditInput } from "../provider/provider.types.js";
import {
  isPlatformRuntimeSettingsStoreUnavailable,
  isPrismaRuntimeConnectivityError,
  toRuntimeSettingsStorageUnavailableError,
} from "./runtime-settings.storage-errors.js";

export type RuntimeSettingsDbClient =
  Prisma.TransactionClient | ReturnType<typeof getPrismaClient>;

export interface IRuntimeSettingsRepository {
  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
  findByKey(
    key: PlatformRuntimeSettingKey,
    client?: RuntimeSettingsDbClient,
  ): Promise<PlatformRuntimeSetting | null>;
  findByKeys(
    keys: PlatformRuntimeSettingKey[],
    client?: RuntimeSettingsDbClient,
  ): Promise<PlatformRuntimeSetting[]>;
  createSetting(
    input: {
      key: PlatformRuntimeSettingKey;
      intValue: number;
      updatedByUserId: string;
    },
    client?: RuntimeSettingsDbClient,
  ): Promise<PlatformRuntimeSetting>;
  updateSettingWithVersion(
    input: {
      key: PlatformRuntimeSettingKey;
      intValue: number;
      expectedVersion: number;
      updatedByUserId: string;
    },
    client?: RuntimeSettingsDbClient,
  ): Promise<PlatformRuntimeSetting | null>;
  createAudit(
    input: CreateAuditInput,
    client?: RuntimeSettingsDbClient,
  ): Promise<AdminAuditLog>;
}

function handleRuntimeSettingsQueryError(error: unknown): never {
  if (
    isPlatformRuntimeSettingsStoreUnavailable(error) ||
    isPrismaRuntimeConnectivityError(error)
  ) {
    throw toRuntimeSettingsStorageUnavailableError(error);
  }
  throw error;
}

export class PrismaRuntimeSettingsRepository implements IRuntimeSettingsRepository {
  private db(client?: RuntimeSettingsDbClient) {
    return client ?? getPrismaClient();
  }

  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return getPrismaClient().$transaction(fn);
  }

  async findByKey(
    key: PlatformRuntimeSettingKey,
    client?: RuntimeSettingsDbClient,
  ): Promise<PlatformRuntimeSetting | null> {
    try {
      return await this.db(client).platformRuntimeSetting.findUnique({
        where: { key },
      });
    } catch (error) {
      return handleRuntimeSettingsQueryError(error);
    }
  }

  async findByKeys(
    keys: PlatformRuntimeSettingKey[],
    client?: RuntimeSettingsDbClient,
  ): Promise<PlatformRuntimeSetting[]> {
    if (keys.length === 0) return Promise.resolve([]);
    try {
      return await this.db(client).platformRuntimeSetting.findMany({
        where: { key: { in: keys } },
      });
    } catch (error) {
      return handleRuntimeSettingsQueryError(error);
    }
  }

  createSetting(
    input: {
      key: PlatformRuntimeSettingKey;
      intValue: number;
      updatedByUserId: string;
    },
    client?: RuntimeSettingsDbClient,
  ): Promise<PlatformRuntimeSetting> {
    return this.db(client).platformRuntimeSetting.create({
      data: {
        key: input.key,
        intValue: input.intValue,
        version: 1,
        updatedByUserId: input.updatedByUserId,
      },
    });
  }

  async updateSettingWithVersion(
    input: {
      key: PlatformRuntimeSettingKey;
      intValue: number;
      expectedVersion: number;
      updatedByUserId: string;
    },
    client?: RuntimeSettingsDbClient,
  ): Promise<PlatformRuntimeSetting | null> {
    const result = await this.db(client).platformRuntimeSetting.updateMany({
      where: {
        key: input.key,
        version: input.expectedVersion,
      },
      data: {
        intValue: input.intValue,
        version: { increment: 1 },
        updatedByUserId: input.updatedByUserId,
      },
    });
    if (result.count === 0) {
      return null;
    }
    return this.findByKey(input.key, client);
  }

  createAudit(
    input: CreateAuditInput,
    client?: RuntimeSettingsDbClient,
  ): Promise<AdminAuditLog> {
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
}

export const runtimeSettingsRepository = new PrismaRuntimeSettingsRepository();
