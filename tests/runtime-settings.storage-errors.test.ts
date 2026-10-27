import { describe, expect, it } from "vitest";
import {
  isPlatformRuntimeSettingsStoreUnavailable,
  isPostgresAbortedTransactionError,
  migrationLikelyFromRuntimeSettingsError,
  RuntimeSettingsStorageUnavailableError,
} from "../src/modules/runtime-settings/runtime-settings.storage-errors.js";

describe("runtime-settings.storage-errors", () => {
  it("detects missing table and enum mismatch", () => {
    expect(isPlatformRuntimeSettingsStoreUnavailable({ code: "P2021" })).toBe(true);
    expect(
      isPlatformRuntimeSettingsStoreUnavailable(
        new Error(
          'invalid input value for enum "PlatformRuntimeSettingKey": "PLATFORM_SERVICE_FEE_PERCENT"',
        ),
      ),
    ).toBe(true);
  });

  it("detects aborted PostgreSQL transactions including wrapped causes", () => {
    const root = Object.assign(new Error("current transaction is aborted"), {
      code: "25P02",
    });
    const wrapped = new Error("Invalid create invocation") as Error & {
      cause?: unknown;
    };
    wrapped.cause = root;
    expect(isPostgresAbortedTransactionError(wrapped)).toBe(true);
  });

  it("classifies migration likelihood from enum errors in the cause chain", () => {
    const cause = new Error("invalid input value for enum PlatformRuntimeSettingKey");
    const error = new RuntimeSettingsStorageUnavailableError(cause);
    expect(migrationLikelyFromRuntimeSettingsError(error)).toBe(true);
    expect(
      migrationLikelyFromRuntimeSettingsError(new Error("some other database failure")),
    ).toBe(false);
  });
});
