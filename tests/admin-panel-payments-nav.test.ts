import { describe, expect, it } from "vitest";
import { navGroups } from "../../admin-panel/src/components/navConfig.ts";

describe("admin-panel payments navigation", () => {
  it("lists Payments before Reports in Operations", () => {
    const operations = navGroups.find((group) => group.label === "Operations");
    expect(operations).toBeDefined();
    const labels = operations!.items.map((item) => item.label);
    const paymentsIndex = labels.indexOf("Payments");
    const reportsIndex = labels.indexOf("Reports");
    expect(paymentsIndex).toBeGreaterThanOrEqual(0);
    expect(reportsIndex).toBeGreaterThan(paymentsIndex);
    expect(operations!.items[paymentsIndex]?.href).toBe("/payments");
  });
});
