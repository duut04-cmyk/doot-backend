import { describe, expect, it } from "vitest";
import {
  buildAdminDeliveriesListPath,
  deliveryDetailBackendPath,
  deliveryHistoryBackendPath,
  deliveryOrchestrationBackendPath,
  isValidDeliveryId,
} from "../../admin-panel/src/lib/bff/deliveries.ts";

const VALID_DELIVERY_ID = "00000000-0000-4000-8000-000000000001";

describe("admin-panel delivery BFF helpers", () => {
  it("builds admin list path with allowlisted query params only", () => {
    const params = new URLSearchParams({
      page: "2",
      limit: "10",
      status: "DELIVERED",
      reference: "DOOT-100",
      from: "2026-01-01T00:00:00+05:30",
      to: "2026-01-31T23:59:59+05:30",
      search: "ignored",
      role: "ADMIN",
    });

    const path = buildAdminDeliveriesListPath(params);
    expect(path.startsWith("/api/v1/admin/deliveries?")).toBe(true);
    const query = new URL(path, "http://localhost").searchParams;
    expect(query.get("page")).toBe("2");
    expect(query.get("limit")).toBe("10");
    expect(query.get("status")).toBe("DELIVERED");
    expect(query.get("reference")).toBe("DOOT-100");
    expect(query.get("from")).toBe("2026-01-01T00:00:00+05:30");
    expect(query.get("to")).toBe("2026-01-31T23:59:59+05:30");
    expect(query.has("search")).toBe(false);
    expect(query.has("role")).toBe(false);
  });

  it("omits empty allowlisted query values", () => {
    const params = new URLSearchParams({ page: "1", reference: "   " });
    expect(buildAdminDeliveriesListPath(params)).toBe(
      "/api/v1/admin/deliveries?page=1",
    );
  });

  it("returns base admin list path when no supported params are present", () => {
    expect(buildAdminDeliveriesListPath(new URLSearchParams())).toBe(
      "/api/v1/admin/deliveries",
    );
  });

  it("validates delivery ids as UUIDs and rejects traversal-like values", () => {
    expect(isValidDeliveryId(VALID_DELIVERY_ID)).toBe(true);
    expect(isValidDeliveryId("DOOT-1001")).toBe(false);
    expect(isValidDeliveryId("../admin")).toBe(false);
    expect(isValidDeliveryId("00000000-0000-4000-8000-000000000001/extra")).toBe(false);
    expect(isValidDeliveryId("")).toBe(false);
  });

  it("builds encoded backend paths for detail, history, and orchestration", () => {
    expect(deliveryDetailBackendPath(VALID_DELIVERY_ID)).toBe(
      `/api/v1/deliveries/${VALID_DELIVERY_ID}`,
    );
    expect(deliveryHistoryBackendPath(VALID_DELIVERY_ID)).toBe(
      `/api/v1/admin/deliveries/${VALID_DELIVERY_ID}/history`,
    );
    expect(deliveryOrchestrationBackendPath(VALID_DELIVERY_ID)).toBe(
      `/api/v1/deliveries/${VALID_DELIVERY_ID}/orchestration`,
    );
  });
});
