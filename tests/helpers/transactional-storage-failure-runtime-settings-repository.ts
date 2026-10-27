import type { PlatformRuntimeSettingKey, Prisma } from "@prisma/client";
import {
  isPlatformRuntimeSettingsStoreUnavailable,
  toRuntimeSettingsStorageUnavailableError,
} from "../../src/modules/runtime-settings/runtime-settings.storage-errors.js";
import { InMemoryRuntimeSettingsRepository } from "./in-memory-runtime-settings-repository.js";

/**
 * Test double: simulates Prisma repository behavior when a storage/enum read fails
 * inside an active transaction (must not be treated as a missing row).
 */
export class TransactionalStorageFailureRuntimeSettingsRepository extends InMemoryRuntimeSettingsRepository {
  /** When set, findByKey throws this error if a transaction client is passed. */
  findByKeyErrorInTransaction: unknown | null = null;

  /** When set, findByKeys throws this error for non-transactional reads. */
  findByKeysReadError: unknown | null = null;

  /** When set with findByKeysReadError, only fail reads whose key set includes this key. */
  findByKeysFailWhenQueryIncludes: PlatformRuntimeSettingKey | null = null;

  createSettingCallCount = 0;

  override async findByKey(
    key: PlatformRuntimeSettingKey,
    client?: unknown,
  ): Promise<ReturnType<InMemoryRuntimeSettingsRepository["findByKey"]>> {
    if (client !== undefined && this.findByKeyErrorInTransaction != null) {
      if (isPlatformRuntimeSettingsStoreUnavailable(this.findByKeyErrorInTransaction)) {
        throw toRuntimeSettingsStorageUnavailableError(
          this.findByKeyErrorInTransaction,
        );
      }
      throw this.findByKeyErrorInTransaction;
    }
    return super.findByKey(key, client);
  }

  override async findByKeys(
    keys: PlatformRuntimeSettingKey[],
    client?: unknown,
  ): Promise<ReturnType<InMemoryRuntimeSettingsRepository["findByKeys"]>> {
    if (client === undefined && this.findByKeysReadError != null) {
      const shouldFail =
        this.findByKeysFailWhenQueryIncludes == null ||
        keys.includes(this.findByKeysFailWhenQueryIncludes);
      if (shouldFail) {
        throw toRuntimeSettingsStorageUnavailableError(this.findByKeysReadError);
      }
    }
    return super.findByKeys(keys, client);
  }

  override async createSetting(
    input: Parameters<InMemoryRuntimeSettingsRepository["createSetting"]>[0],
    client?: Prisma.TransactionClient,
  ) {
    this.createSettingCallCount += 1;
    return super.createSetting(input, client);
  }
}
