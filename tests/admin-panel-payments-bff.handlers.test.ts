import { describe, expect, it, vi } from "vitest";
import { parseBackendJson } from "../../admin-panel/src/lib/backendClient.ts";
import {
  handleFinanceTimeseriesGet,
  handlePaymentsListGet,
  handlePaymentsSummaryGet,
  handleRefundsListGet,
} from "../../admin-panel/src/lib/bff/paymentsHandlers.ts";

describe("admin-panel payments BFF handlers", () => {
  it("forwards payment summary with from and to", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { collections: {} } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const response = await handlePaymentsSummaryGet(
      new Request(
        "http://localhost/api/payments/summary?from=2026-01-01T00:00:00.000%2B05:30&to=2026-01-08T00:00:00.000%2B05:30",
      ),
      { fetch, parse: parseBackendJson },
    );
    expect(response.status).toBe(200);
    expect(String(fetch.mock.calls[0]![0])).toContain("/api/v1/admin/payments/summary");
  });

  it("rejects summary without date range", async () => {
    const fetch = vi.fn();
    const response = await handlePaymentsSummaryGet(
      new Request("http://localhost/api/payments/summary"),
      { fetch, parse: parseBackendJson },
    );
    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards payments list with default pagination", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { items: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await handlePaymentsListGet(new Request("http://localhost/api/payments"), {
      fetch,
      parse: parseBackendJson,
    });
    const path = String(fetch.mock.calls[0]![0]);
    expect(path).toContain("/api/v1/admin/payments");
    expect(path).toContain("page=1");
    expect(path).toContain("limit=10");
  });

  it("forwards paidFrom and paidTo on payments list", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { items: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await handlePaymentsListGet(
      new Request(
        "http://localhost/api/payments?paidFrom=2026-01-01T00%3A00%3A00.000%2B05%3A30&paidTo=2026-01-08T00%3A00%3A00.000%2B05%3A30",
      ),
      { fetch, parse: parseBackendJson },
    );
    const path = String(fetch.mock.calls[0]![0]);
    expect(path).toContain("paidFrom=");
    expect(path).toContain("paidTo=");
  });

  it("forwards activityFrom and activityTo on refunds list", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { items: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await handleRefundsListGet(
      new Request(
        "http://localhost/api/refunds?activityFrom=2026-01-01T00%3A00%3A00.000%2B05%3A30&activityTo=2026-01-08T00%3A00%3A00.000%2B05%3A30",
      ),
      { fetch, parse: parseBackendJson },
    );
    const path = String(fetch.mock.calls[0]![0]);
    expect(path).toContain("activityFrom=");
    expect(path).toContain("activityTo=");
  });

  it("forwards finance timeseries granularity", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { points: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await handleFinanceTimeseriesGet(
      new Request(
        "http://localhost/api/finance/timeseries?from=2026-01-01T00:00:00.000%2B05:30&to=2026-01-08T00:00:00.000%2B05:30&granularity=week",
      ),
      { fetch, parse: parseBackendJson },
    );
    expect(String(fetch.mock.calls[0]![0])).toContain("granularity=week");
  });
});
