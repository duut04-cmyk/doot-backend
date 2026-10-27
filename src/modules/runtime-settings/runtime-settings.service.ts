import type { PlatformRuntimeSetting, PlatformRuntimeSettingKey } from "@prisma/client";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import {
  BOOKING_RUNTIME_SETTING_KEYS,
  PLATFORM_RUNTIME_SETTING_AUDIT_RESOURCE_ID,
  PRICING_RUNTIME_SETTING_KEYS,
} from "./runtime-settings.constants.js";
import type { PatchBookingPoliciesInput } from "./runtime-settings.schema.js";
import {
  runtimeSettingsRepository,
  type IRuntimeSettingsRepository,
} from "./runtime-settings.repository.js";
import type {
  BookingRuntimeSettingStates,
  BookingRuntimeSettings,
  PatchBookingPoliciesAuditOutcome,
  PricingRuntimeSettingStates,
  PricingRuntimeSettings,
  RuntimeSettingChange,
  RuntimeSettingState,
} from "./runtime-settings.types.js";
import {
  getErrorCauseChain,
  isPlatformRuntimeSettingsStoreUnavailable,
  isPostgresAbortedTransactionError,
  isRuntimeSettingsStorageUnavailableError,
  migrationLikelyFromRuntimeSettingsError,
} from "./runtime-settings.storage-errors.js";
import {
  parseStoredBookingPriceTolerancePercent,
  parseStoredBookingQuoteMaxAgeSeconds,
  parseStoredPlatformServiceFeePercent,
} from "./runtime-settings.validation.js";
type RuntimePolicyField =
  "quoteMaxAgeSeconds" | "priceTolerancePercent" | "platformServiceFeePercent";

const KEY_BY_FIELD: Record<RuntimePolicyField, PlatformRuntimeSettingKey> = {
  quoteMaxAgeSeconds: "BOOKING_QUOTE_MAX_AGE_SECONDS",
  priceTolerancePercent: "BOOKING_PRICE_TOLERANCE_PERCENT",
  platformServiceFeePercent: "PLATFORM_SERVICE_FEE_PERCENT",
};

const ENV_DEFAULT_BY_FIELD: Record<RuntimePolicyField, number> = {
  quoteMaxAgeSeconds: env.BOOKING_QUOTE_MAX_AGE_SECONDS,
  priceTolerancePercent: env.BOOKING_PRICE_TOLERANCE_PERCENT,
  platformServiceFeePercent: env.PLATFORM_SERVICE_FEE_PERCENT,
};

function toPatchPersistenceAppError(error: unknown): AppError | null {
  if (error instanceof AppError) {
    return null;
  }

  const chain = getErrorCauseChain(error);
  const migrationLikely = chain.some((item) =>
    migrationLikelyFromRuntimeSettingsError(item),
  );

  if (
    isRuntimeSettingsStorageUnavailableError(error) ||
    chain.some((item) => isRuntimeSettingsStorageUnavailableError(item)) ||
    chain.some((item) => isPlatformRuntimeSettingsStoreUnavailable(item))
  ) {
    return new AppError(
      migrationLikely
        ? "Platform runtime settings storage is not available. Apply database migrations before updating policies."
        : "Platform runtime settings storage is not available. Retry later or contact operations.",
      {
        statusCode: 503,
        code: ErrorCodes.INTERNAL_ERROR,
      },
    );
  }

  if (isPostgresAbortedTransactionError(error)) {
    return new AppError(
      migrationLikely
        ? "Platform runtime settings storage is not available. Apply database migrations before updating policies."
        : "Platform runtime settings could not be saved because the database transaction failed. Retry after resolving storage issues.",
      {
        statusCode: 503,
        code: ErrorCodes.INTERNAL_ERROR,
      },
    );
  }

  return null;
}

function parseStoredValue(
  key: PlatformRuntimeSettingKey,
  intValue: number,
): number | null {
  if (key === "BOOKING_QUOTE_MAX_AGE_SECONDS") {
    return parseStoredBookingQuoteMaxAgeSeconds(intValue);
  }
  if (key === "BOOKING_PRICE_TOLERANCE_PERCENT") {
    return parseStoredBookingPriceTolerancePercent(intValue);
  }
  return parseStoredPlatformServiceFeePercent(intValue);
}

export class RuntimeSettingsService {
  constructor(
    private readonly repository: IRuntimeSettingsRepository = runtimeSettingsRepository,
  ) {}

  /**
   * Resolves effective booking policies (database override when valid, else env).
   * Reads persisted settings on each call — no in-process cache. Multiple backend
   * instances converge on the last committed database value after their next read.
   */
  async getBookingPolicies(): Promise<BookingRuntimeSettings> {
    const states = await this.getBookingSettingStates();
    return {
      quoteMaxAgeSeconds: states.quoteMaxAgeSeconds.value,
      priceTolerancePercent: states.priceTolerancePercent.value,
    };
  }

  async getPlatformServiceFeePercent(): Promise<number> {
    const states = await this.getPricingSettingStates();
    return states.platformServiceFeePercent.value;
  }

  async getPricingPolicies(): Promise<PricingRuntimeSettings> {
    const states = await this.getPricingSettingStates();
    return {
      platformServiceFeePercent: states.platformServiceFeePercent.value,
    };
  }

  async getBookingSettingStates(): Promise<BookingRuntimeSettingStates> {
    const loaded = await this.loadRuntimeSettingRows([...BOOKING_RUNTIME_SETTING_KEYS]);
    if (!loaded.ok) {
      return {
        quoteMaxAgeSeconds: this.resolveFieldState("quoteMaxAgeSeconds", null, {
          storageUnavailable: true,
        }),
        priceTolerancePercent: this.resolveFieldState("priceTolerancePercent", null, {
          storageUnavailable: true,
        }),
      };
    }
    const byKey = new Map(loaded.rows.map((row) => [row.key, row]));

    return {
      quoteMaxAgeSeconds: this.resolveFieldState(
        "quoteMaxAgeSeconds",
        byKey.get("BOOKING_QUOTE_MAX_AGE_SECONDS") ?? null,
      ),
      priceTolerancePercent: this.resolveFieldState(
        "priceTolerancePercent",
        byKey.get("BOOKING_PRICE_TOLERANCE_PERCENT") ?? null,
      ),
    };
  }

  async getPricingSettingStates(): Promise<PricingRuntimeSettingStates> {
    const loaded = await this.loadRuntimeSettingRows([...PRICING_RUNTIME_SETTING_KEYS]);
    if (!loaded.ok) {
      return {
        platformServiceFeePercent: this.resolveFieldState(
          "platformServiceFeePercent",
          null,
          {
            storageUnavailable: true,
          },
        ),
      };
    }
    const byKey = new Map(loaded.rows.map((row) => [row.key, row]));

    return {
      platformServiceFeePercent: this.resolveFieldState(
        "platformServiceFeePercent",
        byKey.get("PLATFORM_SERVICE_FEE_PERCENT") ?? null,
      ),
    };
  }

  private async loadRuntimeSettingRows(
    keys: PlatformRuntimeSettingKey[],
  ): Promise<{ ok: true; rows: PlatformRuntimeSetting[] } | { ok: false }> {
    try {
      const rows = await this.repository.findByKeys(keys);
      return { ok: true, rows };
    } catch (error) {
      if (isRuntimeSettingsStorageUnavailableError(error)) {
        logger.warn({ err: error }, "platform_runtime_settings_read_unavailable");
        return { ok: false };
      }
      throw error;
    }
  }

  async patchBookingPolicies(input: {
    adminUserId: string;
    requestId: string;
    body: PatchBookingPoliciesInput;
  }): Promise<{
    booking: BookingRuntimeSettingStates;
    pricing: PricingRuntimeSettingStates;
    audit: PatchBookingPoliciesAuditOutcome;
  }> {
    const currentBooking = await this.getBookingSettingStates();
    const currentPricing = await this.getPricingSettingStates();
    const requestedBooking = input.body.booking ?? {};
    const requestedPricing = input.body.pricing ?? {};
    const changes: RuntimeSettingChange[] = [];

    const planned: Array<{
      field: RuntimePolicyField;
      key: PlatformRuntimeSettingKey;
      newValue: number;
      expectedVersion: number;
      currentValue: number;
    }> = [];

    if (requestedBooking.quoteMaxAgeSeconds !== undefined) {
      if (
        input.body.expectedVersions.quoteMaxAgeSeconds !==
        currentBooking.quoteMaxAgeSeconds.version
      ) {
        throw new AppError(
          "Booking policy settings were updated elsewhere. Refresh and retry.",
          {
            statusCode: 409,
            code: ErrorCodes.CONFLICT,
          },
        );
      }
      if (
        requestedBooking.quoteMaxAgeSeconds !== currentBooking.quoteMaxAgeSeconds.value
      ) {
        planned.push({
          field: "quoteMaxAgeSeconds",
          key: KEY_BY_FIELD.quoteMaxAgeSeconds,
          newValue: requestedBooking.quoteMaxAgeSeconds,
          expectedVersion: currentBooking.quoteMaxAgeSeconds.version,
          currentValue: currentBooking.quoteMaxAgeSeconds.value,
        });
      }
    }

    if (requestedBooking.priceTolerancePercent !== undefined) {
      if (
        input.body.expectedVersions.priceTolerancePercent !==
        currentBooking.priceTolerancePercent.version
      ) {
        throw new AppError(
          "Booking policy settings were updated elsewhere. Refresh and retry.",
          {
            statusCode: 409,
            code: ErrorCodes.CONFLICT,
          },
        );
      }
      if (
        requestedBooking.priceTolerancePercent !==
        currentBooking.priceTolerancePercent.value
      ) {
        planned.push({
          field: "priceTolerancePercent",
          key: KEY_BY_FIELD.priceTolerancePercent,
          newValue: requestedBooking.priceTolerancePercent,
          expectedVersion: currentBooking.priceTolerancePercent.version,
          currentValue: currentBooking.priceTolerancePercent.value,
        });
      }
    }

    if (requestedPricing.platformServiceFeePercent !== undefined) {
      if (
        input.body.expectedVersions.platformServiceFeePercent !==
        currentPricing.platformServiceFeePercent.version
      ) {
        throw new AppError(
          "Booking policy settings were updated elsewhere. Refresh and retry.",
          {
            statusCode: 409,
            code: ErrorCodes.CONFLICT,
          },
        );
      }
      if (
        requestedPricing.platformServiceFeePercent !==
        currentPricing.platformServiceFeePercent.value
      ) {
        planned.push({
          field: "platformServiceFeePercent",
          key: KEY_BY_FIELD.platformServiceFeePercent,
          newValue: requestedPricing.platformServiceFeePercent,
          expectedVersion: currentPricing.platformServiceFeePercent.version,
          currentValue: currentPricing.platformServiceFeePercent.value,
        });
      }
    }

    if (planned.length === 0) {
      return {
        booking: currentBooking,
        pricing: currentPricing,
        audit: { outcome: "no_change", changes: [] },
      };
    }

    try {
      await this.repository.withTransaction(async (tx) => {
        for (const item of planned) {
          if (item.expectedVersion === 0) {
            const existing = await this.repository.findByKey(item.key, tx);
            if (existing) {
              throw new AppError(
                "Booking policy settings were updated elsewhere. Refresh and retry.",
                {
                  statusCode: 409,
                  code: ErrorCodes.CONFLICT,
                },
              );
            }
            const created = await this.repository.createSetting(
              {
                key: item.key,
                intValue: item.newValue,
                updatedByUserId: input.adminUserId,
              },
              tx,
            );
            changes.push({
              key: item.key,
              previousValue: item.currentValue,
              newValue: item.newValue,
              previousVersion: 0,
              newVersion: created.version,
            });
            continue;
          }

          const updated = await this.repository.updateSettingWithVersion(
            {
              key: item.key,
              intValue: item.newValue,
              expectedVersion: item.expectedVersion,
              updatedByUserId: input.adminUserId,
            },
            tx,
          );
          if (!updated) {
            throw new AppError(
              "Booking policy settings were updated elsewhere. Refresh and retry.",
              {
                statusCode: 409,
                code: ErrorCodes.CONFLICT,
              },
            );
          }
          changes.push({
            key: item.key,
            previousValue: item.currentValue,
            newValue: item.newValue,
            previousVersion: item.expectedVersion,
            newVersion: updated.version,
          });
        }

        await this.repository.createAudit(
          {
            adminUserId: input.adminUserId,
            requestId: input.requestId,
            action: "PLATFORM_RUNTIME_SETTING_UPDATED",
            resourceType: "PLATFORM_RUNTIME_SETTING",
            resourceId: PLATFORM_RUNTIME_SETTING_AUDIT_RESOURCE_ID,
            metadata: {
              outcome: "updated",
              changes: changes.map((change) => ({
                key: change.key,
                previousValue: change.previousValue,
                newValue: change.newValue,
                previousVersion: change.previousVersion,
                newVersion: change.newVersion,
              })),
            },
          },
          tx,
        );
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      const mapped = toPatchPersistenceAppError(error);
      if (mapped) {
        logger.warn(
          { err: error, requestId: input.requestId },
          "platform_runtime_settings_patch_failed",
        );
        throw mapped;
      }
      throw error;
    }

    const booking = await this.getBookingSettingStates();
    const pricing = await this.getPricingSettingStates();
    return {
      booking,
      pricing,
      audit: { outcome: "updated", changes },
    };
  }

  private resolveFieldState(
    field: RuntimePolicyField,
    row: { intValue: number; version: number } | null,
    options?: { storageUnavailable?: boolean },
  ): RuntimeSettingState {
    const envDefault = ENV_DEFAULT_BY_FIELD[field];
    if (options?.storageUnavailable) {
      return {
        value: envDefault,
        source: "env",
        version: 0,
        restartRequired: false,
        storageUnavailable: true,
      };
    }
    if (!row) {
      return {
        value: envDefault,
        source: "env",
        version: 0,
        restartRequired: false,
      };
    }
    const parsed = parseStoredValue(KEY_BY_FIELD[field], row.intValue);
    if (parsed == null) {
      logger.warn(
        {
          key: KEY_BY_FIELD[field],
          storedValue: row.intValue,
          version: row.version,
        },
        "invalid_platform_runtime_setting_ignored",
      );
      return {
        value: envDefault,
        source: "env",
        version: row.version,
        restartRequired: false,
        invalidStoredOverride: true,
      };
    }
    return {
      value: parsed,
      source: "database",
      version: row.version,
      restartRequired: false,
    };
  }
}

export const runtimeSettingsService = new RuntimeSettingsService();
