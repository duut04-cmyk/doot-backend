import { describe, expect, it, vi } from "vitest";
import type {
  ProviderDetail,
  ProviderSummary,
} from "../../admin-panel/src/data/providerTypes.ts";
import {
  planListEnabledChange,
  providerSummaryFromDetail,
  setProviderEnabledFromList,
} from "../../admin-panel/src/providers/providerListLifecycle.ts";

const baseSummary: ProviderSummary = {
  id: "00000000-0000-4000-8000-000000000010",
  code: "MOCK",
  name: "Mock Provider",
  displayName: "Mock",
  environment: "SANDBOX",
  status: "ACTIVE",
  enabled: true,
  orchestrationEnabled: true,
  priority: 100,
  integrationStatus: "CONFIGURED",
  orchestrationEligible: false,
  health: { status: "UNKNOWN", lastCheckedAt: null, lastError: null },
  credentials: { configured: true, fields: [] },
  capabilities: ["BOOKING"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const baseDetail: ProviderDetail = {
  ...baseSummary,
  description: null,
  settings: {
    timeoutMs: 30000,
    connectTimeoutMs: 10000,
    maxRetries: 2,
    retryDelayMs: 1000,
    webhookEnabled: false,
    healthCheckEnabled: true,
    healthCheckIntervalMs: 300000,
  },
  packageLimits: null,
  services: [],
  vehicles: [],
};

describe("admin-panel provider list lifecycle", () => {
  it("plans ACTIVE status when enabling from the list", () => {
    expect(planListEnabledChange({ orchestrationEnabled: false }, true)).toEqual([
      { kind: "status", body: { status: "ACTIVE" } },
    ]);
  });

  it("plans INACTIVE status and orchestration off when disabling", () => {
    expect(planListEnabledChange({ orchestrationEnabled: true }, false)).toEqual([
      { kind: "status", body: { status: "INACTIVE" } },
      { kind: "orchestrationOff", body: { orchestrationEnabled: false } },
    ]);
  });

  it("skips orchestration PATCH when already off", () => {
    expect(planListEnabledChange({ orchestrationEnabled: false }, false)).toEqual([
      { kind: "status", body: { status: "INACTIVE" } },
    ]);
  });

  it("maps provider detail to list summary fields", () => {
    const summary = providerSummaryFromDetail(baseDetail);
    expect(summary).toEqual(baseSummary);
    expect("settings" in summary).toBe(false);
  });

  it("uses status endpoint then orchestration PATCH when disabling", async () => {
    const updateProviderStatus = vi.fn().mockResolvedValue({
      success: true,
      data: { ...baseDetail, status: "INACTIVE", enabled: false },
    });
    const updateProvider = vi.fn().mockResolvedValue({
      success: true,
      data: {
        ...baseDetail,
        status: "INACTIVE",
        enabled: false,
        orchestrationEnabled: false,
      },
    });

    const result = await setProviderEnabledFromList(baseSummary, false, {
      updateProviderStatus,
      updateProvider,
    });

    expect(updateProviderStatus).toHaveBeenCalledWith(baseSummary.id, {
      status: "INACTIVE",
    });
    expect(updateProvider).toHaveBeenCalledWith(baseSummary.id, {
      orchestrationEnabled: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.orchestrationEnabled).toBe(false);
    }
  });

  it("uses only status endpoint when enabling", async () => {
    const updateProviderStatus = vi.fn().mockResolvedValue({
      success: true,
      data: { ...baseDetail, status: "ACTIVE", enabled: true },
    });
    const updateProvider = vi.fn();

    await setProviderEnabledFromList(
      { ...baseSummary, enabled: false, status: "INACTIVE" },
      true,
      { updateProviderStatus, updateProvider },
    );

    expect(updateProviderStatus).toHaveBeenCalledWith(baseSummary.id, {
      status: "ACTIVE",
    });
    expect(updateProvider).not.toHaveBeenCalled();
  });

  it("preserves prior state on status failure without orchestration call", async () => {
    const updateProviderStatus = vi.fn().mockResolvedValue({
      success: false,
      error: "Provider not found.",
    });
    const updateProvider = vi.fn();

    const result = await setProviderEnabledFromList(baseSummary, false, {
      updateProviderStatus,
      updateProvider,
    });

    expect(result.success).toBe(false);
    expect(updateProvider).not.toHaveBeenCalled();
  });
});
