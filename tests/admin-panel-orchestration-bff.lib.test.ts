import { describe, expect, it } from "vitest";
import { buildAdminOrchestrationsListPath } from "../../admin-panel/src/lib/bff/orchestrations.ts";

describe("admin-panel orchestration BFF helpers", () => {
  it("builds admin orchestration list path with allowlisted query params only", () => {
    const params = new URLSearchParams({
      page: "2",
      limit: "10",
      reference: "DOOT-100",
      orchestrationStatus: "COMPLETED",
      deliveryStatus: "DELIVERED",
      bookingStatus: "BOOKED",
      from: "2026-01-01T00:00:00+05:30",
      to: "2026-01-31T23:59:59+05:30",
      search: "ignored",
      role: "ADMIN",
    });

    const path = buildAdminOrchestrationsListPath(params);
    expect(path.startsWith("/api/v1/admin/orchestrations?")).toBe(true);
    const query = new URL(path, "http://localhost").searchParams;
    expect(query.get("page")).toBe("2");
    expect(query.get("limit")).toBe("10");
    expect(query.get("reference")).toBe("DOOT-100");
    expect(query.get("orchestrationStatus")).toBe("COMPLETED");
    expect(query.get("deliveryStatus")).toBe("DELIVERED");
    expect(query.get("bookingStatus")).toBe("BOOKED");
    expect(query.has("search")).toBe(false);
    expect(query.has("role")).toBe(false);
  });

  it("returns base path when no supported params are present", () => {
    expect(buildAdminOrchestrationsListPath(new URLSearchParams())).toBe(
      "/api/v1/admin/orchestrations",
    );
  });
});
