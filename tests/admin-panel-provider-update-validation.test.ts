import { describe, expect, it } from "vitest";
import type { ProviderDetail } from "../../admin-panel/src/data/providerTypes.ts";
import {
  buildProviderUpdatePatch,
  draftFromProvider,
  operationalFlagsChanged,
  validateEnvironment,
  validatePriorityInput,
  validateProviderConfigurationDraft,
} from "../../admin-panel/src/providers/providerUpdateValidation.ts";

const baseProvider: ProviderDetail = {
  id: "00000000-0000-4000-8000-000000000010",
  code: "MOCK",
  name: "Mock Provider",
  displayName: "Mock",
  description: "Desc",
  environment: "SANDBOX",
  status: "ACTIVE",
  enabled: true,
  orchestrationEnabled: true,
  priority: 100,
  integrationStatus: "CONFIGURED",
  orchestrationEligible: false,
  health: { status: "UNKNOWN", lastCheckedAt: null, lastError: null },
  credentials: { configured: false, fields: [] },
  capabilities: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
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

describe("admin-panel provider update validation", () => {
  it("accepts priority at 0 and 1000", () => {
    expect(validatePriorityInput("0")).toBeNull();
    expect(validatePriorityInput("1000")).toBeNull();
  });

  it("rejects priority outside range and non-integers", () => {
    expect(validatePriorityInput("1001")).toMatch(/between/);
    expect(validatePriorityInput("-1")).toMatch(/between/);
    expect(validatePriorityInput("12.5")).toMatch(/whole number/);
    expect(validatePriorityInput("abc")).toMatch(/whole number/);
  });

  it("validates environment against backend enum", () => {
    expect(validateEnvironment("SANDBOX")).toBe(true);
    expect(validateEnvironment("LIVE")).toBe(true);
    expect(validateEnvironment("STAGING")).toBe(false);
  });

  it("builds a patch with only changed fields", () => {
    const draft = draftFromProvider(baseProvider);
    draft.priority = "200";
    draft.displayName = "New label";

    const result = buildProviderUpdatePatch(draft, baseProvider);
    expect("patch" in result).toBe(true);
    if ("patch" in result) {
      expect(result.patch).toEqual({
        priority: 200,
        displayName: "New label",
      });
    }
  });

  it("patches orchestrationEnabled only and never enabled", () => {
    const draft = draftFromProvider(baseProvider);
    draft.orchestrationEnabled = false;

    const result = buildProviderUpdatePatch(draft, baseProvider);
    expect("patch" in result).toBe(true);
    if ("patch" in result) {
      expect(result.patch).toEqual({ orchestrationEnabled: false });
      expect(result.patch).not.toHaveProperty("enabled");
    }
  });

  it("returns error when there are no changes", () => {
    const draft = draftFromProvider(baseProvider);
    const result = buildProviderUpdatePatch(draft, baseProvider);
    expect("error" in result).toBe(true);
  });

  it("rejects orchestration enabled while provider disabled on server", () => {
    const disabled: ProviderDetail = {
      ...baseProvider,
      enabled: false,
      orchestrationEnabled: false,
    };
    const draft = draftFromProvider(disabled);
    draft.orchestrationEnabled = true;
    const errors = validateProviderConfigurationDraft(draft, disabled);
    expect(errors.orchestrationEnabled).toMatch(/Lifecycle status/);
  });

  it("rejects orchestration enabled while provider suspended", () => {
    const suspended: ProviderDetail = {
      ...baseProvider,
      status: "SUSPENDED",
      enabled: false,
      orchestrationEnabled: false,
    };
    const draft = draftFromProvider(suspended);
    draft.orchestrationEnabled = true;
    const errors = validateProviderConfigurationDraft(draft, suspended);
    expect(errors.orchestrationEnabled).toMatch(/suspended/i);
  });

  it("operationalFlagsChanged is true only for orchestrationEnabled", () => {
    const draft = draftFromProvider(baseProvider);
    expect(operationalFlagsChanged(draft, baseProvider)).toBe(false);
    draft.orchestrationEnabled = false;
    expect(operationalFlagsChanged(draft, baseProvider)).toBe(true);
  });
});
