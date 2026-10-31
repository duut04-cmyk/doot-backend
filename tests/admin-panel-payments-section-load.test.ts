import { describe, expect, it, vi, beforeEach } from "vitest";
import * as api from "../../admin-panel/src/payments/api.ts";
import {
  loadReconciliationSection,
  loadSummarySection,
} from "../../admin-panel/src/payments/paymentsSectionLoad.ts";

describe("payments section load isolation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("summary failure does not throw and returns error state", async () => {
    vi.spyOn(api, "fetchPaymentSummary").mockResolvedValue({
      success: false,
      error: "boom",
    });
    const state = await loadSummarySection({ from: "a", to: "b" });
    expect(state.error).toBe("boom");
    expect(state.data).toBeNull();
  });

  it("reconciliation failure clears success path (no data)", async () => {
    vi.spyOn(api, "fetchFinanceReconciliation").mockResolvedValue({
      success: false,
      error: "recon failed",
    });
    const state = await loadReconciliationSection({ from: "a", to: "b", limit: 10 });
    expect(state.error).toBe("recon failed");
    expect(state.data).toBeNull();
  });
});
