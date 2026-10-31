import { describe, expect, it } from "vitest";
import { mergeRefundListWhere } from "../src/modules/admin-finance/admin-finance.refund-list-filters.js";

describe("mergeRefundListWhere", () => {
  const from = new Date("2026-01-01T00:00:00.000+05:30");
  const to = new Date("2026-01-08T00:00:00.000+05:30");

  it("uses OR on requestedAt and processedAt for activity window", () => {
    const where = mergeRefundListWhere({
      activityFrom: from,
      activityToExclusive: to,
    });
    expect(where.OR).toHaveLength(2);
    expect(where.OR?.[0]).toMatchObject({
      requestedAt: { gte: from, lt: to },
    });
    expect(where.OR?.[1]).toMatchObject({
      processedAt: { gte: from, lt: to },
    });
  });

  it("ANDs status filter with activity window", () => {
    const where = mergeRefundListWhere({
      activityFrom: from,
      activityToExclusive: to,
      status: "SUCCESS",
    });
    expect(where.AND).toHaveLength(2);
  });
});
