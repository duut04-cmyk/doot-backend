import { describe, expect, it } from "vitest";
import { resolveReportingWindow } from "../../admin-panel/src/lib/reportingDateRange.ts";

describe("resolveReportingWindow", () => {
  it("returns half-open windows with from before to", () => {
    const window = resolveReportingWindow("7d", new Date("2026-01-15T12:00:00.000Z"));
    expect(Date.parse(window.from)).toBeLessThan(Date.parse(window.to));
  });

  it("builds month window starting on day 1 in Asia/Kolkata", () => {
    const window = resolveReportingWindow(
      "month",
      new Date("2026-03-20T10:00:00.000Z"),
    );
    expect(window.from).toBe("2026-02-28T18:30:00.000Z");
    expect(window.to).toBe("2026-03-20T18:30:00.000Z");
  });
});
