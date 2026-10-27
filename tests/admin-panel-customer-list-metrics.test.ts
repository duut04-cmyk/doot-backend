import { describe, expect, it } from "vitest";
import type { CustomerSummary } from "../../admin-panel/src/data/customerTypes.ts";
import {
  buildCustomerListSummaryMetrics,
  getCustomerPageMetrics,
} from "../../admin-panel/src/customers/components/utils.ts";

function customer(overrides: Partial<CustomerSummary> = {}): CustomerSummary {
  return {
    id: "c1",
    name: "Test",
    email: "test@example.com",
    phone: null,
    emailVerified: true,
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    oauthProviders: [],
    stats: { totalDeliveries: 0, lastDeliveryAt: null },
    ...overrides,
  };
}

describe("admin-panel customer list metrics", () => {
  it("uses API matching total separately from page counts", () => {
    const page = [
      customer(),
      customer({
        status: "SUSPENDED",
        emailVerified: false,
        stats: { totalDeliveries: 2, lastDeliveryAt: null },
      }),
    ];
    const metrics = buildCustomerListSummaryMetrics(500, page);
    expect(metrics.matchingTotal).toBe(500);
    expect(metrics.onPage.rowCount).toBe(2);
    expect(metrics.onPage.active).toBe(1);
    expect(metrics.onPage.withDeliveries).toBe(1);
  });

  it("returns null matching total when unavailable", () => {
    const metrics = buildCustomerListSummaryMetrics(null, [customer()]);
    expect(metrics.matchingTotal).toBeNull();
  });

  it("computes page metrics only from provided rows", () => {
    const pageMetrics = getCustomerPageMetrics([
      customer({ emailVerified: false }),
      customer({ stats: { totalDeliveries: 1, lastDeliveryAt: null } }),
    ]);
    expect(pageMetrics.verified).toBe(1);
    expect(pageMetrics.withDeliveries).toBe(1);
  });
});
