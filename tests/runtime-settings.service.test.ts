import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "../src/config/env.js";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { RuntimeSettingsService } from "../src/modules/runtime-settings/runtime-settings.service.js";
import { InMemoryRuntimeSettingsRepository } from "./helpers/in-memory-runtime-settings-repository.js";

describe("RuntimeSettingsService", () => {
  let repository: InMemoryRuntimeSettingsRepository;
  let service: RuntimeSettingsService;
  let adminUserId: string;

  beforeEach(() => {
    repository = new InMemoryRuntimeSettingsRepository();
    service = new RuntimeSettingsService(repository);
    adminUserId = randomUUID();
  });

  it("falls back to env defaults when no database overrides exist", async () => {
    const policies = await service.getBookingPolicies();
    expect(policies).toEqual({
      quoteMaxAgeSeconds: env.BOOKING_QUOTE_MAX_AGE_SECONDS,
      priceTolerancePercent: env.BOOKING_PRICE_TOLERANCE_PERCENT,
    });
    const states = await service.getBookingSettingStates();
    expect(states.quoteMaxAgeSeconds.version).toBe(0);
    expect(states.priceTolerancePercent.version).toBe(0);
  });

  it("prefers valid database overrides over env defaults", async () => {
    await repository.createSetting({
      key: "BOOKING_QUOTE_MAX_AGE_SECONDS",
      intValue: 450,
      updatedByUserId: adminUserId,
    });

    const policies = await service.getBookingPolicies();
    expect(policies.quoteMaxAgeSeconds).toBe(450);
  });

  it("uses env effective value but preserves row version when stored value is invalid", async () => {
    await repository.createSetting({
      key: "BOOKING_PRICE_TOLERANCE_PERCENT",
      intValue: 500,
      updatedByUserId: adminUserId,
    });

    const policies = await service.getBookingPolicies();
    expect(policies.priceTolerancePercent).toBe(env.BOOKING_PRICE_TOLERANCE_PERCENT);
    const states = await service.getBookingSettingStates();
    expect(states.priceTolerancePercent).toMatchObject({
      value: env.BOOKING_PRICE_TOLERANCE_PERCENT,
      source: "env",
      version: 1,
      invalidStoredOverride: true,
    });
  });

  it("repairs an invalid stored value when admin PATCH matches the persisted version", async () => {
    await repository.createSetting({
      key: "BOOKING_PRICE_TOLERANCE_PERCENT",
      intValue: 500,
      updatedByUserId: adminUserId,
    });

    const result = await service.patchBookingPolicies({
      adminUserId,
      requestId: "repair-invalid-row",
      body: {
        booking: { priceTolerancePercent: 5 },
        expectedVersions: {
          quoteMaxAgeSeconds: 0,
          priceTolerancePercent: 1,
          platformServiceFeePercent: 0,
        },
      },
    });

    expect(result.booking.priceTolerancePercent).toMatchObject({
      value: 5,
      source: "database",
      version: 2,
    });
    expect(result.booking.priceTolerancePercent.invalidStoredOverride).toBeUndefined();
    expect(repository.settings.get("BOOKING_PRICE_TOLERANCE_PERCENT")?.intValue).toBe(
      5,
    );
  });

  it("returns conflict when expected version is stale for an invalid stored row", async () => {
    await repository.createSetting({
      key: "BOOKING_PRICE_TOLERANCE_PERCENT",
      intValue: 500,
      updatedByUserId: adminUserId,
    });

    await expect(
      service.patchBookingPolicies({
        adminUserId,
        requestId: "stale-version",
        body: {
          booking: { priceTolerancePercent: 5 },
          expectedVersions: {
            quoteMaxAgeSeconds: 0,
            priceTolerancePercent: 0,
            platformServiceFeePercent: 0,
          },
        },
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.CONFLICT,
    });

    expect(repository.settings.get("BOOKING_PRICE_TOLERANCE_PERCENT")?.intValue).toBe(
      500,
    );
  });

  it("defaults platform service fee to env when no override exists", async () => {
    expect(await service.getPlatformServiceFeePercent()).toBe(
      env.PLATFORM_SERVICE_FEE_PERCENT,
    );
    const states = await service.getPricingSettingStates();
    expect(states.platformServiceFeePercent).toMatchObject({
      value: env.PLATFORM_SERVICE_FEE_PERCENT,
      source: "env",
      version: 0,
    });
  });

  it("persists platform service fee updates with audit metadata", async () => {
    const result = await service.patchBookingPolicies({
      adminUserId,
      requestId: "fee-update",
      body: {
        pricing: { platformServiceFeePercent: 15 },
        expectedVersions: {
          quoteMaxAgeSeconds: 0,
          priceTolerancePercent: 0,
          platformServiceFeePercent: 0,
        },
      },
    });

    expect(result.pricing.platformServiceFeePercent).toMatchObject({
      value: 15,
      source: "database",
      version: 1,
    });
    expect(await service.getPlatformServiceFeePercent()).toBe(15);
  });

  it("ignores invalid stored platform fee overrides", async () => {
    await repository.createSetting({
      key: "PLATFORM_SERVICE_FEE_PERCENT",
      intValue: 101,
      updatedByUserId: adminUserId,
    });

    const states = await service.getPricingSettingStates();
    expect(states.platformServiceFeePercent).toMatchObject({
      value: env.PLATFORM_SERVICE_FEE_PERCENT,
      source: "env",
      invalidStoredOverride: true,
      version: 1,
    });
  });
});
