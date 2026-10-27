/**
 * Shared detection for platform runtime settings persistence/read failures
 * (missing table, enum mismatch, aborted transactions).
 */

export class RuntimeSettingsStorageUnavailableError extends Error {
  constructor(cause: unknown) {
    super("platform_runtime_settings_storage_unavailable", { cause });
    this.name = "RuntimeSettingsStorageUnavailableError";
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

export function getErrorCauseChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current != null && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    if (typeof current === "object" && current !== null && "cause" in current) {
      current = (current as { cause?: unknown }).cause;
    } else {
      break;
    }
  }
  return chain;
}

export function isPlatformRuntimeSettingsStoreUnavailable(error: unknown): boolean {
  for (const item of getErrorCauseChain(error)) {
    const code = errorCode(item);
    if (code === "P2021") {
      return true;
    }
    const message = errorMessage(item);
    if (
      message.includes("invalid input value for enum") &&
      message.includes("PlatformRuntimeSettingKey")
    ) {
      return true;
    }
    if (
      message.includes("PlatformRuntimeSetting") &&
      message.includes("does not exist")
    ) {
      return true;
    }
  }
  return false;
}

export function isPostgresAbortedTransactionError(error: unknown): boolean {
  for (const item of getErrorCauseChain(error)) {
    const code = errorCode(item);
    if (code === "25P02" || code === "P2034") {
      return true;
    }
    const message = errorMessage(item);
    if (
      message.includes("25P02") ||
      message.includes("current transaction is aborted") ||
      message.includes("commands ignored until end of transaction block")
    ) {
      return true;
    }
  }
  return false;
}

export function isRuntimeSettingsStorageUnavailableError(
  error: unknown,
): error is RuntimeSettingsStorageUnavailableError {
  return error instanceof RuntimeSettingsStorageUnavailableError;
}

export function migrationLikelyFromRuntimeSettingsError(error: unknown): boolean {
  return isPlatformRuntimeSettingsStoreUnavailable(error);
}

export function toRuntimeSettingsStorageUnavailableError(
  error: unknown,
): RuntimeSettingsStorageUnavailableError {
  if (error instanceof RuntimeSettingsStorageUnavailableError) {
    return error;
  }
  return new RuntimeSettingsStorageUnavailableError(error);
}
