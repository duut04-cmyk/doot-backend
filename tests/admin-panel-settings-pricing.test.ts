import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsSnapshot } from "../../admin-panel/src/data/settingsTypes.ts";
import { patchRuntimePolicies } from "../../admin-panel/src/settings/api.ts";
import {
  buildPatchPricingPoliciesBody,
  draftFromPricingRuntime,
  validatePlatformServiceFeeDraft,
} from "../../admin-panel/src/settings/pricingPoliciesPatch.ts";
import {
  applyPatchResultToSnapshot,
  invalidOverrideWarning,
  resolvePricingRuntime,
} from "../../admin-panel/src/settings/runtimePoliciesShared.ts";

function makeSnapshot(overrides?: Partial<SettingsSnapshot>): SettingsSnapshot {
  return {
    platform: {
      appName: "Doot",
      nodeEnv: "development",
      port: 5000,
      frontendUrl: null,
      adminFrontendUrl: null,
    },
    policies: {
      booking: { quoteMaxAgeSeconds: 300, priceTolerancePercent: 0 },
      pricing: { platformServiceFeePercent: 10 },
      auth: {
        jwtAccessExpiresIn: "15m",
        refreshTokenExpiresInDays: 30,
        bcryptRounds: 12,
        passwordResetTokenExpirySeconds: 900,
        emailVerificationOtpExpiryMinutes: 15,
        otpResendCooldownSeconds: 60,
      },
      deliveryOtp: {
        expirySeconds: 600,
        maxAttempts: 5,
        generationCooldownSeconds: 60,
      },
      orchestration: {
        requireKnownCancellationPolicy: true,
        scoreWeights: {
          price: 1,
          eta: 1,
          availability: 1,
          providerPriority: 1,
          serviceQuality: 1,
        },
      },
    },
    flags: { mockProviderAdapter: false, developmentMode: true },
    runtime: {
      booking: {
        quoteMaxAgeSeconds: {
          value: 300,
          source: "env",
          version: 0,
          restartRequired: false,
        },
        priceTolerancePercent: {
          value: 0,
          source: "env",
          version: 0,
          restartRequired: false,
        },
      },
      pricing: {
        platformServiceFeePercent: {
          value: 10,
          source: "env",
          version: 0,
          restartRequired: false,
        },
      },
    },
    checkedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const defaultPricingPatchResult = {
  booking: makeSnapshot().runtime!.booking,
  pricing: {
    platformServiceFeePercent: {
      value: 15,
      source: "database" as const,
      version: 1,
      restartRequired: false as const,
    },
  },
  audit: { outcome: "updated" as const, changes: [] },
};

describe("pricingPoliciesPatch helpers", () => {
  it("derives pricing runtime from policies when runtime metadata is missing", () => {
    const snapshot = makeSnapshot({ runtime: undefined });
    expect(resolvePricingRuntime(snapshot).platformServiceFeePercent.value).toBe(10);
  });

  it("initializes draft from runtime values", () => {
    const runtime = resolvePricingRuntime(makeSnapshot());
    expect(draftFromPricingRuntime(runtime)).toEqual({
      platformServiceFeePercent: "10",
    });
  });

  it("accepts valid fee values including 0 and 100", () => {
    for (const value of ["0", "10", "100"]) {
      expect(
        validatePlatformServiceFeeDraft({ platformServiceFeePercent: value }).valid,
      ).toBe(true);
    }
  });

  it("rejects empty, fractional, negative, and over-100 values", () => {
    for (const value of ["", "10.5", "-1", "101"]) {
      expect(
        validatePlatformServiceFeeDraft({ platformServiceFeePercent: value }).valid,
      ).toBe(false);
    }
  });

  it("builds PATCH body with pricing change and all expected versions", () => {
    const snapshot = makeSnapshot();
    const body = buildPatchPricingPoliciesBody({
      draft: { platformServiceFeePercent: "15" },
      snapshot,
    });
    expect(body).toEqual({
      pricing: { platformServiceFeePercent: 15 },
      expectedVersions: {
        quoteMaxAgeSeconds: 0,
        priceTolerancePercent: 0,
        platformServiceFeePercent: 0,
      },
    });
  });

  it("merges PATCH response without dropping booking runtime metadata", () => {
    const snapshot = makeSnapshot();
    const next = applyPatchResultToSnapshot(snapshot, defaultPricingPatchResult);
    expect(next.policies.pricing.platformServiceFeePercent).toBe(15);
    expect(next.runtime?.pricing.platformServiceFeePercent.version).toBe(1);
    expect(next.runtime?.booking.quoteMaxAgeSeconds.version).toBe(0);
  });

  it("returns invalid override warning copy when flagged", () => {
    expect(
      invalidOverrideWarning({
        value: 10,
        source: "env",
        version: 2,
        restartRequired: false,
        invalidStoredOverride: true,
      }),
    ).toContain("invalid");
  });

  it("returns storage unavailable warning without implying a database override", () => {
    const message = invalidOverrideWarning({
      value: 10,
      source: "env",
      version: 0,
      restartRequired: false,
      storageUnavailable: true,
    });
    expect(message).toContain("could not be read");
    expect(message).toContain("migrations");
  });
});

describe("patchRuntimePolicies api client (pricing)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: defaultPricingPatchResult,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards pricing PATCH with platformServiceFeePercent expected version", async () => {
    const result = await patchRuntimePolicies({
      pricing: { platformServiceFeePercent: 15 },
      expectedVersions: {
        quoteMaxAgeSeconds: 0,
        priceTolerancePercent: 0,
        platformServiceFeePercent: 0,
      },
    });
    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledWith("/api/settings/policies", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pricing: { platformServiceFeePercent: 15 },
        expectedVersions: {
          quoteMaxAgeSeconds: 0,
          priceTolerancePercent: 0,
          platformServiceFeePercent: 0,
        },
      }),
      cache: "no-store",
    });
  });

  it("surfaces 409 without treating it as success", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: {
            message:
              "Booking policy settings were updated elsewhere. Refresh and retry.",
          },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    const result = await patchRuntimePolicies({
      pricing: { platformServiceFeePercent: 15 },
      expectedVersions: {
        quoteMaxAgeSeconds: 0,
        priceTolerancePercent: 0,
        platformServiceFeePercent: 0,
      },
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(409);
  });

  it("surfaces network failures without mock fallback", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Network down"));
    await expect(
      patchRuntimePolicies({
        pricing: { platformServiceFeePercent: 15 },
        expectedVersions: {
          quoteMaxAgeSeconds: 0,
          priceTolerancePercent: 0,
          platformServiceFeePercent: 0,
        },
      }),
    ).rejects.toThrow("Network down");
  });
});
