import { describe, expect, it } from "vitest";
import {
  buildReplaceCapabilitiesBody,
  capabilitiesSelectionChanged,
  draftCapabilitiesFromDetail,
  isProviderCapability,
  PROVIDER_CAPABILITY_VALUES,
  sortCapabilities,
  validateCapabilitySelection,
} from "../../admin-panel/src/providers/providerCapabilities.ts";
import type { ProviderCapability } from "../../admin-panel/src/data/providerTypes.ts";

describe("admin-panel provider capabilities contract", () => {
  it("matches the backend capability enum set", () => {
    expect(PROVIDER_CAPABILITY_VALUES).toHaveLength(12);
    expect(PROVIDER_CAPABILITY_VALUES).toContain("SERVICEABILITY");
    expect(PROVIDER_CAPABILITY_VALUES).toContain("BOOKING");
    expect(PROVIDER_CAPABILITY_VALUES).toContain("CANCELLATION");
  });

  it("initializes draft from detail capabilities", () => {
    const draft = draftCapabilitiesFromDetail(["PRICING", "BOOKING"]);
    expect(draft).toEqual(["PRICING", "BOOKING"]);
  });

  it("builds replace body with sorted multiple capabilities", () => {
    const body = buildReplaceCapabilitiesBody(["BOOKING", "PRICING", "SERVICEABILITY"]);
    expect(body).toEqual({
      capabilities: ["SERVICEABILITY", "PRICING", "BOOKING"],
    });
  });

  it("allows an empty capability set", () => {
    const body = buildReplaceCapabilitiesBody([]);
    expect(body).toEqual({ capabilities: [] });
    expect(validateCapabilitySelection([])).toBeNull();
  });

  it("rejects unsupported capability values", () => {
    expect(isProviderCapability("NOT_A_CAPABILITY")).toBe(false);
    expect(() =>
      buildReplaceCapabilitiesBody([
        "BOOKING",
        "NOT_A_CAPABILITY" as ProviderCapability,
      ]),
    ).toThrow(/Unsupported capability/);
  });

  it("detects selection changes against server state", () => {
    expect(capabilitiesSelectionChanged(["BOOKING"], ["BOOKING"])).toBe(false);
    expect(capabilitiesSelectionChanged([], ["BOOKING"])).toBe(true);
  });

  it("sorts capabilities in backend enum order", () => {
    expect(sortCapabilities(["BOOKING", "OTP", "SERVICEABILITY"])).toEqual([
      "SERVICEABILITY",
      "BOOKING",
      "OTP",
    ]);
  });
});
