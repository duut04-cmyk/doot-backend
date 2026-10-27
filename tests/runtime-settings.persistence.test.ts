import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config/env.js";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { RuntimeSettingsService } from "../src/modules/runtime-settings/runtime-settings.service.js";
import { InMemoryRuntimeSettingsRepository } from "./helpers/in-memory-runtime-settings-repository.js";
import { TransactionalStorageFailureRuntimeSettingsRepository } from "./helpers/transactional-storage-failure-runtime-settings-repository.js";

describe("Runtime settings persistence error handling", () => {
  let adminUserId: string;

  beforeEach(() => {
    adminUserId = randomUUID();
  });

  it("still creates a row when findByKey returns null outside a storage failure", async () => {
    const repository = new InMemoryRuntimeSettingsRepository();
    const service = new RuntimeSettingsService(repository);

    const result = await service.patchBookingPolicies({
      adminUserId,
      requestId: "create-booking-policy",
      body: {
        booking: { quoteMaxAgeSeconds: 600 },
        expectedVersions: {
          quoteMaxAgeSeconds: 0,
          priceTolerancePercent: 0,
          platformServiceFeePercent: 0,
        },
      },
    });

    expect(result.booking.quoteMaxAgeSeconds).toMatchObject({
      value: 600,
      source: "database",
      version: 1,
    });
    expect(repository.settings.size).toBe(1);
  });

  it("does not call create after a transactional storage read failure (mocked enum error)", async () => {
    const repository = new TransactionalStorageFailureRuntimeSettingsRepository();
    repository.findByKeyErrorInTransaction = new Error(
      'invalid input value for enum "PlatformRuntimeSettingKey": "PLATFORM_SERVICE_FEE_PERCENT"',
    );
    const service = new RuntimeSettingsService(repository);

    await expect(
      service.patchBookingPolicies({
        adminUserId,
        requestId: "fee-create-blocked",
        body: {
          pricing: { platformServiceFeePercent: 12 },
          expectedVersions: {
            quoteMaxAgeSeconds: 0,
            priceTolerancePercent: 0,
            platformServiceFeePercent: 0,
          },
        },
      }),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: ErrorCodes.INTERNAL_ERROR,
      message: expect.stringContaining("Apply database migrations"),
    });

    expect(repository.createSettingCallCount).toBe(0);
    expect(repository.settings.size).toBe(0);
    expect(repository.auditLogs).toHaveLength(0);
  });

  it("maps aborted transaction errors to 503 without claiming migration when cause is unknown", async () => {
    const repository = new TransactionalStorageFailureRuntimeSettingsRepository();
    repository.findByKeyErrorInTransaction = Object.assign(
      new Error(
        "current transaction is aborted, commands ignored until end of transaction block",
      ),
      { code: "25P02" },
    );
    const service = new RuntimeSettingsService(repository);

    await expect(
      service.patchBookingPolicies({
        adminUserId,
        requestId: "aborted-tx",
        body: {
          pricing: { platformServiceFeePercent: 12 },
          expectedVersions: {
            quoteMaxAgeSeconds: 0,
            priceTolerancePercent: 0,
            platformServiceFeePercent: 0,
          },
        },
      }),
    ).rejects.toMatchObject({
      statusCode: 503,
      message: expect.stringContaining("database transaction failed"),
    });
    expect(repository.createSettingCallCount).toBe(0);
  });

  it("returns 409 for stale versions when storage is healthy", async () => {
    const repository = new InMemoryRuntimeSettingsRepository();
    const service = new RuntimeSettingsService(repository);

    await service.patchBookingPolicies({
      adminUserId,
      requestId: "initial",
      body: {
        booking: { quoteMaxAgeSeconds: 600 },
        expectedVersions: {
          quoteMaxAgeSeconds: 0,
          priceTolerancePercent: 0,
          platformServiceFeePercent: 0,
        },
      },
    });

    await expect(
      service.patchBookingPolicies({
        adminUserId,
        requestId: "stale",
        body: {
          booking: { quoteMaxAgeSeconds: 900 },
          expectedVersions: {
            quoteMaxAgeSeconds: 0,
            priceTolerancePercent: 0,
            platformServiceFeePercent: 0,
          },
        },
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: ErrorCodes.CONFLICT,
    });
  });

  it("rolls back setting changes when audit persistence fails", async () => {
    const repository = new InMemoryRuntimeSettingsRepository();
    repository.failAuditAfterUpdates = true;
    const service = new RuntimeSettingsService(repository);

    await expect(
      service.patchBookingPolicies({
        adminUserId,
        requestId: "audit-fail",
        body: {
          booking: { quoteMaxAgeSeconds: 600 },
          expectedVersions: {
            quoteMaxAgeSeconds: 0,
            priceTolerancePercent: 0,
            platformServiceFeePercent: 0,
          },
        },
      }),
    ).rejects.toThrow();

    expect(repository.settings.size).toBe(0);
    expect(repository.auditLogs).toHaveLength(0);
  });

  it("marks pricing runtime state storageUnavailable when findByKeys fails on read", async () => {
    const repository = new TransactionalStorageFailureRuntimeSettingsRepository();
    repository.findByKeysReadError = new Error(
      'invalid input value for enum "PlatformRuntimeSettingKey": "PLATFORM_SERVICE_FEE_PERCENT"',
    );
    repository.findByKeysFailWhenQueryIncludes = "PLATFORM_SERVICE_FEE_PERCENT";
    const service = new RuntimeSettingsService(repository);

    const pricing = await service.getPricingSettingStates();
    expect(pricing.platformServiceFeePercent).toMatchObject({
      value: env.PLATFORM_SERVICE_FEE_PERCENT,
      source: "env",
      version: 0,
      storageUnavailable: true,
    });

    const booking = await service.getBookingSettingStates();
    expect(booking.quoteMaxAgeSeconds.storageUnavailable).toBeUndefined();
    expect(booking.quoteMaxAgeSeconds.value).toBe(env.BOOKING_QUOTE_MAX_AGE_SECONDS);
  });

  it("marks only pricing storage unavailable when pricing keys fail in isolation", async () => {
    const repository = new TransactionalStorageFailureRuntimeSettingsRepository();
    const service = new RuntimeSettingsService(repository);

    await repository.createSetting({
      key: "BOOKING_QUOTE_MAX_AGE_SECONDS",
      intValue: 450,
      updatedByUserId: adminUserId,
    });

    repository.findByKeysReadError = new Error("enum mismatch for pricing key");
    repository.findByKeysFailWhenQueryIncludes = "PLATFORM_SERVICE_FEE_PERCENT";
    const booking = await service.getBookingSettingStates();
    expect(booking.quoteMaxAgeSeconds).toMatchObject({
      value: 450,
      source: "database",
      version: 1,
    });

    const pricing = await service.getPricingSettingStates();
    expect(pricing.platformServiceFeePercent.storageUnavailable).toBe(true);
  });

  it("rethrows non-storage programming errors from findByKeys", async () => {
    const repository = new InMemoryRuntimeSettingsRepository();
    const service = new RuntimeSettingsService(repository);
    const spy = vi
      .spyOn(repository, "findByKeys")
      .mockRejectedValueOnce(new TypeError("bug"));

    await expect(service.getBookingSettingStates()).rejects.toBeInstanceOf(TypeError);
    spy.mockRestore();
  });
});
