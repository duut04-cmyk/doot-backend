import { describe, expect, it } from "vitest";
import {
  DEFAULT_HISTORY_ERROR,
  applyDeliveryHistoryFetch,
} from "../../admin-panel/src/orchestration/historyLoad.ts";

describe("admin-panel orchestration history load", () => {
  it("maps a successful history payload", () => {
    const history = {
      delivery: {
        id: "d1",
        reference: "REF",
        status: "CREATED",
        createdAt: "",
        updatedAt: "",
      },
    } as Parameters<typeof applyDeliveryHistoryFetch>[0]["data"];

    const result = applyDeliveryHistoryFetch({ success: true, data: history });

    expect(result.history).toBe(history);
    expect(result.historyError).toBeNull();
  });

  it("maps success without data to a default error", () => {
    const result = applyDeliveryHistoryFetch({ success: true });

    expect(result.history).toBeNull();
    expect(result.historyError).toBe(DEFAULT_HISTORY_ERROR);
  });

  it("maps API failure to the error message", () => {
    const result = applyDeliveryHistoryFetch({
      success: false,
      error: "Network timeout",
    });

    expect(result.history).toBeNull();
    expect(result.historyError).toBe("Network timeout");
  });

  it("uses default error when failure has no message", () => {
    const result = applyDeliveryHistoryFetch({ success: false });

    expect(result.history).toBeNull();
    expect(result.historyError).toBe(DEFAULT_HISTORY_ERROR);
  });
});
