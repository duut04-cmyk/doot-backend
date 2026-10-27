import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyPatchResultToSnapshot,
  buildPatchBookingPoliciesBody,
  draftFromRuntime,
  formatRuntimeSource,
  resolveBookingRuntime,
  validateBookingPolicyDraft,
} from "../../admin-panel/src/settings/bookingPoliciesPatch.ts";
import { patchRuntimePolicies } from "../../admin-panel/src/settings/api.ts";
import type { SettingsSnapshot } from "../../admin-panel/src/data/settingsTypes.ts";

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

const defaultPatchResult = {
  booking: {
    quoteMaxAgeSeconds: {
      value: 600,
      source: "database" as const,
      version: 1,
      restartRequired: false as const,
    },
    priceTolerancePercent: {
      value: 0,
      source: "env" as const,
      version: 0,
      restartRequired: false as const,
    },
  },
  pricing: makeSnapshot().runtime!.pricing,
  audit: { outcome: "updated" as const, changes: [] },
};

describe("bookingPoliciesPatch helpers", () => {
  it("formats runtime source labels for display", () => {
    expect(formatRuntimeSource("env")).toBe("Environment");
    expect(formatRuntimeSource("database")).toBe("Database override");
  });

  it("derives runtime metadata from effective policies when runtime is missing", () => {
    const snapshot = makeSnapshot({ runtime: undefined });
    const runtime = resolveBookingRuntime(snapshot);
    expect(runtime.quoteMaxAgeSeconds).toEqual({
      value: 300,
      source: "env",
      version: 0,
      restartRequired: false,
    });
  });

  it("initializes draft from runtime values", () => {
    const runtime = resolveBookingRuntime(makeSnapshot());
    expect(draftFromRuntime(runtime)).toEqual({
      quoteMaxAgeSeconds: "300",
      priceTolerancePercent: "0",
    });
  });

  it("rejects invalid draft values", () => {
    expect(
      validateBookingPolicyDraft({
        quoteMaxAgeSeconds: "0",
        priceTolerancePercent: "0",
      }).valid,
    ).toBe(false);
    expect(
      validateBookingPolicyDraft({
        quoteMaxAgeSeconds: "300",
        priceTolerancePercent: "101",
      }).valid,
    ).toBe(false);
  });

  it("accepts valid draft values", () => {
    const result = validateBookingPolicyDraft({
      quoteMaxAgeSeconds: "600",
      priceTolerancePercent: "5",
    });
    expect(result.valid).toBe(true);
  });

  it("builds PATCH body with only changed fields and expected versions", () => {
    const snapshot = makeSnapshot();
    const body = buildPatchBookingPoliciesBody({
      draft: { quoteMaxAgeSeconds: "600", priceTolerancePercent: "0" },
      snapshot,
    });
    expect(body).toEqual({
      booking: { quoteMaxAgeSeconds: 600 },
      expectedVersions: {
        quoteMaxAgeSeconds: 0,
        priceTolerancePercent: 0,
        platformServiceFeePercent: 0,
      },
    });
  });

  it("does not include arbitrary keys in PATCH body", () => {
    const snapshot = makeSnapshot();
    const body = buildPatchBookingPoliciesBody({
      draft: { quoteMaxAgeSeconds: "600", priceTolerancePercent: "0" },
      snapshot,
    });
    expect(JSON.stringify(body)).not.toContain("nodeEnv");
    expect(JSON.stringify(body)).not.toContain("JWT");
  });

  it("merges PATCH response into snapshot effective and runtime values", () => {
    const snapshot = makeSnapshot();
    const next = applyPatchResultToSnapshot(snapshot, defaultPatchResult);
    expect(next.policies.booking.quoteMaxAgeSeconds).toBe(600);
    expect(next.runtime?.booking.quoteMaxAgeSeconds.version).toBe(1);
    expect(next.policies.pricing.platformServiceFeePercent).toBe(10);
  });
});

describe("patchRuntimePolicies api client (booking)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: defaultPatchResult,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits allowlisted PATCH fields to the settings policies BFF", async () => {
    const result = await patchRuntimePolicies({
      booking: { quoteMaxAgeSeconds: 600 },
      expectedVersions: {
        quoteMaxAgeSeconds: 0,
        priceTolerancePercent: 0,
        platformServiceFeePercent: 0,
      },
    });
    expect(result.success).toBe(true);
    expect(result.data?.booking.quoteMaxAgeSeconds.value).toBe(600);
    expect(fetch).toHaveBeenCalledWith("/api/settings/policies", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        booking: { quoteMaxAgeSeconds: 600 },
        expectedVersions: {
          quoteMaxAgeSeconds: 0,
          priceTolerancePercent: 0,
          platformServiceFeePercent: 0,
        },
      }),
      cache: "no-store",
    });
  });

  it("surfaces HTTP 409 conflict status without treating it as success", async () => {
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
      booking: { quoteMaxAgeSeconds: 600 },
      expectedVersions: {
        quoteMaxAgeSeconds: 0,
        priceTolerancePercent: 0,
        platformServiceFeePercent: 0,
      },
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(409);
  });

  it("surfaces HTTP 503 when persistent store is unavailable", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: {
            message:
              "Platform runtime settings storage is not available. Apply database migrations before updating policies.",
          },
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      ),
    );
    const result = await patchRuntimePolicies({
      booking: { quoteMaxAgeSeconds: 600 },
      expectedVersions: {
        quoteMaxAgeSeconds: 0,
        priceTolerancePercent: 0,
        platformServiceFeePercent: 0,
      },
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(503);
  });

  it("surfaces validation errors from the backend", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: { message: "Number must be greater than 0" },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    );
    const result = await patchRuntimePolicies({
      booking: { quoteMaxAgeSeconds: -1 },
      expectedVersions: {
        quoteMaxAgeSeconds: 0,
        priceTolerancePercent: 0,
        platformServiceFeePercent: 0,
      },
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
  });
});
