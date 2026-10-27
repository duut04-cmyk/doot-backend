import { describe, expect, it } from "vitest";
import {
  buildStatusUpdateBody,
  describeStatusTransitionImpact,
  isProviderStatus,
  listSelectableStatusTargets,
  PROVIDER_STATUS_VALUES,
  sanitizeStatusUpdateError,
  statusChangeRequiresConfirmation,
} from "../../admin-panel/src/providers/providerStatusValidation.ts";

describe("admin-panel provider status validation", () => {
  it("matches backend status enum values", () => {
    expect(PROVIDER_STATUS_VALUES).toEqual(["ACTIVE", "INACTIVE", "SUSPENDED"]);
    expect(isProviderStatus("ACTIVE")).toBe(true);
    expect(isProviderStatus("INVALID")).toBe(false);
  });

  it("builds PATCH bodies aligned with backend enabled defaults", () => {
    expect(buildStatusUpdateBody("ACTIVE")).toEqual({ status: "ACTIVE" });
    expect(buildStatusUpdateBody("INACTIVE")).toEqual({ status: "INACTIVE" });
    expect(buildStatusUpdateBody("SUSPENDED")).toEqual({
      status: "SUSPENDED",
      enabled: false,
    });
  });

  it("lists only other statuses as selectable targets", () => {
    expect(listSelectableStatusTargets("ACTIVE")).toEqual(["INACTIVE", "SUSPENDED"]);
    expect(listSelectableStatusTargets("SUSPENDED")).toEqual(["ACTIVE", "INACTIVE"]);
  });

  it("requires confirmation when status changes", () => {
    expect(statusChangeRequiresConfirmation("ACTIVE", "INACTIVE")).toBe(true);
    expect(statusChangeRequiresConfirmation("ACTIVE", "ACTIVE")).toBe(false);
  });

  it("describes operational impact and clarifies suspended is not a health outcome", () => {
    const lines = describeStatusTransitionImpact("SUSPENDED", "ACTIVE");
    expect(lines.some((line) => line.includes("Suspended"))).toBe(true);
    expect(
      lines.some((line) =>
        line.toLowerCase().includes("not the same as a failed health"),
      ),
    ).toBe(true);
  });

  it("sanitizes unsafe status update errors", () => {
    expect(sanitizeStatusUpdateError("Provider not found.")).toContain("not found");
    expect(sanitizeStatusUpdateError("Internal stack trace at patchStatus")).toBe(
      "Failed to update provider status.",
    );
  });
});
