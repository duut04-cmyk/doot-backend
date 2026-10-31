import { describe, expect, it } from "vitest";
import { resolveShiprocketNumericOrderIdForCancel } from "../src/modules/provider/adapters/shiprocket/shiprocket-cancel.util.js";
import { isValidShiprocketOrderId } from "../src/modules/provider/adapters/shiprocket/shiprocket-order-show.parse.js";

describe("Shiprocket cancel order id resolution", () => {
  it("validates numeric order ids only", () => {
    expect(isValidShiprocketOrderId("16161616")).toBe(true);
    expect(isValidShiprocketOrderId("DOOT-CHANNEL-1")).toBe(false);
    expect(isValidShiprocketOrderId("")).toBe(false);
  });

  it("prefers providerOrderId when numeric", () => {
    expect(
      resolveShiprocketNumericOrderIdForCancel({
        providerOrderId: "16161616",
        quoteSnapshot: { amount: 1, currency: "INR" },
      }),
    ).toBe("16161616");
  });

  it("falls back to quote snapshot metadata", () => {
    expect(
      resolveShiprocketNumericOrderIdForCancel({
        providerOrderId: "channel-order-id",
        quoteSnapshot: {
          amount: 1,
          currency: "INR",
          providerMetadata: { shiprocketOrderId: "16161616" },
        },
      }),
    ).toBe("16161616");
  });

  it("returns null when no numeric id is available", () => {
    expect(
      resolveShiprocketNumericOrderIdForCancel({
        providerOrderId: "channel-order-id",
        quoteSnapshot: { amount: 1, currency: "INR" },
      }),
    ).toBeNull();
  });
});
