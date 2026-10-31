import { describe, expect, it } from "vitest";
import {
  buildPaymentsListQuery,
  buildRefundsListQuery,
  clampPage,
} from "../../admin-panel/src/payments/paymentsSectionLoad.ts";

describe("payments list query builders", () => {
  const from = "2026-01-01T00:00:00.000+05:30";
  const to = "2026-01-08T00:00:00.000+05:30";

  it("includes finance window on payments list", () => {
    expect(buildPaymentsListQuery({ from, to, page: 2 })).toEqual({
      paidFrom: from,
      paidTo: to,
      page: "2",
    });
  });

  it("includes activity window on refunds list", () => {
    expect(buildRefundsListQuery({ from, to, page: 1 })).toEqual({
      activityFrom: from,
      activityTo: to,
      page: "1",
    });
  });

  it("clamps page to totalPages", () => {
    expect(clampPage(5, 3)).toBe(3);
    expect(clampPage(0, 3)).toBe(1);
    expect(clampPage(2, 0)).toBe(1);
  });
});
