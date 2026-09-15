import { describe, expect, it } from "vitest";
import {
  hasMaterialPriceChange,
  isQuoteStale,
  resolveQuoteTimestamp,
} from "../src/modules/booking/booking.quote-freshness.js";

describe("booking quote freshness", () => {
  it("uses quotedAt from snapshot when present", () => {
    const quotedAt = "2026-01-01T10:00:00.000Z";
    const result = resolveQuoteTimestamp({
      quoteSnapshot: { amount: 100, currency: "INR", quotedAt },
      orchestrationCompletedAt: new Date("2026-01-02T10:00:00.000Z"),
      optionCreatedAt: new Date("2026-01-03T10:00:00.000Z"),
    });
    expect(result.toISOString()).toBe(quotedAt);
  });

  it("marks quote stale after max age", () => {
    const quotedAt = new Date(Date.now() - 400_000);
    expect(isQuoteStale(quotedAt, 300)).toBe(true);
  });

  it("keeps fresh quote within max age", () => {
    const quotedAt = new Date(Date.now() - 60_000);
    expect(isQuoteStale(quotedAt, 300)).toBe(false);
  });

  it("detects material price change with zero tolerance", () => {
    expect(
      hasMaterialPriceChange({
        originalAmount: 150,
        newAmount: 151,
        tolerancePercent: 0,
      }),
    ).toBe(true);
  });

  it("allows price within tolerance", () => {
    expect(
      hasMaterialPriceChange({
        originalAmount: 100,
        newAmount: 101,
        tolerancePercent: 2,
      }),
    ).toBe(false);
  });
});
