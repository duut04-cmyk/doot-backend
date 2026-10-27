import { describe, expect, it, vi } from "vitest";
import { parseBackendJson } from "../../admin-panel/src/lib/backendClient.ts";
import { handleReportingSummaryGet } from "../../admin-panel/src/lib/bff/reportingHandlers.ts";

describe("admin-panel reporting BFF handlers", () => {
  it("forwards summary requests with from and to parameters", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, data: { deliveriesCreated: { total: 0 } } }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleReportingSummaryGet(
      new Request(
        "http://localhost/api/reporting/summary?from=2026-01-01T00:00:00.000%2B05:30&to=2026-01-08T00:00:00.000%2B05:30",
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [path] = fetch.mock.calls[0]!;
    expect(String(path)).toContain("/api/v1/admin/reporting/summary");
    expect(String(path)).toContain("from=");
    expect(String(path)).toContain("to=");
  });

  it("rejects missing date parameters", async () => {
    const fetch = vi.fn();
    const response = await handleReportingSummaryGet(
      new Request("http://localhost/api/reporting/summary"),
      { fetch, parse: parseBackendJson },
    );
    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
