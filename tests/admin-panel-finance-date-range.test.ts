import { describe, expect, it } from "vitest";
import {
  resolveCustomFinanceWindowIst,
  resolveFinanceWindow,
} from "../../admin-panel/src/lib/financeDateRange.ts";

describe("resolveFinanceWindow", () => {
  const now = new Date("2026-03-15T10:00:00.000+05:30");

  it("returns half-open today window in Asia/Kolkata", () => {
    const window = resolveFinanceWindow("today", undefined, now);
    expect(new Date(window.from).toISOString()).toBe("2026-03-14T18:30:00.000Z");
    expect(new Date(window.to).getTime()).toBeGreaterThan(
      new Date(window.from).getTime(),
    );
  });

  it("returns 7-day window ending tomorrow exclusive", () => {
    const window = resolveFinanceWindow("7d", undefined, now);
    expect(
      new Date(window.to).getTime() - new Date(window.from).getTime(),
    ).toBeGreaterThan(6 * 86_400_000);
  });

  it("resolves custom IST range with exclusive end date", () => {
    const window = resolveFinanceWindow("custom", {
      startYmd: "2026-03-01",
      endYmdExclusive: "2026-03-08",
    });
    expect(window.from).toBe("2026-02-28T18:30:00.000Z");
    expect(window.to).toBe("2026-03-07T18:30:00.000Z");
  });

  it("single-day custom window is one IST calendar day", () => {
    const window = resolveCustomFinanceWindowIst({
      startYmd: "2026-03-15",
      endYmdExclusive: "2026-03-16",
    });
    expect(window).not.toBeNull();
    expect(window!.from).toBe("2026-03-14T18:30:00.000Z");
    expect(window!.to).toBe("2026-03-15T18:30:00.000Z");
  });
});

describe("resolveCustomFinanceWindowIst TZ invariance", () => {
  const cases = ["UTC", "America/Los_Angeles"] as const;

  for (const tz of cases) {
    it(`matches fixed instants when TZ=${tz}`, () => {
      const previous = process.env.TZ;
      process.env.TZ = tz;
      try {
        const window = resolveCustomFinanceWindowIst({
          startYmd: "2026-01-01",
          endYmdExclusive: "2026-01-02",
        });
        expect(window).toEqual({
          from: "2025-12-31T18:30:00.000Z",
          to: "2026-01-01T18:30:00.000Z",
        });
      } finally {
        if (previous === undefined) {
          delete process.env.TZ;
        } else {
          process.env.TZ = previous;
        }
      }
    });
  }
});
