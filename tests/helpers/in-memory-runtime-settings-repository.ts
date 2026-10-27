import { randomUUID } from "node:crypto";
import type {
  AdminAuditLog,
  PlatformRuntimeSetting,
  PlatformRuntimeSettingKey,
  Prisma,
} from "@prisma/client";
import type { CreateAuditInput } from "../../src/modules/provider/provider.types.js";
import type { IRuntimeSettingsRepository } from "../../src/modules/runtime-settings/runtime-settings.repository.js";

export class InMemoryRuntimeSettingsRepository implements IRuntimeSettingsRepository {
  settings = new Map<PlatformRuntimeSettingKey, PlatformRuntimeSetting>();
  auditLogs: AdminAuditLog[] = [];
  failAuditAfterUpdates = false;

  async withTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const settingsSnap = new Map(this.settings);
    const auditSnap = this.auditLogs.map((item) => ({ ...item }));
    try {
      return await fn({} as Prisma.TransactionClient);
    } catch (error) {
      this.settings = settingsSnap;
      this.auditLogs = auditSnap;
      throw error;
    }
  }

  findByKey(
    key: PlatformRuntimeSettingKey,
    _client?: unknown,
  ): Promise<PlatformRuntimeSetting | null> {
    const row = this.settings.get(key);
    return Promise.resolve(row ? { ...row } : null);
  }

  findByKeys(
    keys: PlatformRuntimeSettingKey[],
    _client?: unknown,
  ): Promise<PlatformRuntimeSetting[]> {
    return Promise.resolve(
      keys
        .map((key) => this.settings.get(key))
        .filter((row): row is PlatformRuntimeSetting => row != null)
        .map((row) => ({ ...row })),
    );
  }

  createSetting(
    input: {
      key: PlatformRuntimeSettingKey;
      intValue: number;
      updatedByUserId: string;
    },
    _client?: unknown,
  ): Promise<PlatformRuntimeSetting> {
    const now = new Date();
    const row: PlatformRuntimeSetting = {
      key: input.key,
      intValue: input.intValue,
      version: 1,
      updatedByUserId: input.updatedByUserId,
      createdAt: now,
      updatedAt: now,
    };
    this.settings.set(input.key, row);
    return Promise.resolve({ ...row });
  }

  async updateSettingWithVersion(
    input: {
      key: PlatformRuntimeSettingKey;
      intValue: number;
      expectedVersion: number;
      updatedByUserId: string;
    },
    _client?: unknown,
  ): Promise<PlatformRuntimeSetting | null> {
    const existing = this.settings.get(input.key);
    if (!existing || existing.version !== input.expectedVersion) {
      return null;
    }
    const updated: PlatformRuntimeSetting = {
      ...existing,
      intValue: input.intValue,
      version: existing.version + 1,
      updatedByUserId: input.updatedByUserId,
      updatedAt: new Date(),
    };
    this.settings.set(input.key, updated);
    return { ...updated };
  }

  createAudit(input: CreateAuditInput, _client?: unknown): Promise<AdminAuditLog> {
    if (this.failAuditAfterUpdates) {
      throw new Error("audit persistence failed");
    }
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
}
