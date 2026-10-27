import { describe, expect, it, vi } from "vitest";
import { parseBackendJson } from "../../admin-panel/src/lib/backendClient.ts";
import {
  handleDeliveryDetailGet,
  handleDeliveryHistoryGet,
  handleDeliveryListGet,
  handleDeliveryOrchestrationGet,
} from "../../admin-panel/src/lib/bff/deliveryHandlers.ts";

const VALID_DELIVERY_ID = "00000000-0000-4000-8000-000000000001";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("admin-panel delivery BFF handlers", () => {
  it("rejects malformed delivery ids before calling the backend", async () => {
    const fetch = vi.fn();
    const deps = { fetch, parse: parseBackendJson };

    const detail = await handleDeliveryDetailGet("not-a-uuid", deps);
    expect(detail.status).toBe(400);
    expect(await detail.json()).toEqual({
      success: false,
      error: "Invalid delivery id.",
    });

    const history = await handleDeliveryHistoryGet("bad-id", deps);
    expect(history.status).toBe(400);

    const orchestration = await handleDeliveryOrchestrationGet("bad-id", deps);
    expect(orchestration.status).toBe(400);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards list requests to the admin deliveries backend path", async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          success: true,
          data: { items: [], page: 1, limit: 20, total: 0, totalPages: 0 },
        },
        200,
      ),
    );
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleDeliveryListGet(
      new Request(
        "http://localhost/api/deliveries?page=3&limit=5&foo=bar&reference=DOOT",
      ),
      deps,
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/admin/deliveries?page=3&limit=5&reference=DOOT",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { total: 0 } });
  });

  it("calls the expected backend paths for detail, history, and orchestration", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(async () =>
        jsonResponse({ success: true, data: { id: VALID_DELIVERY_ID } }, 200),
      );
    const deps = { fetch, parse: parseBackendJson };

    await handleDeliveryDetailGet(VALID_DELIVERY_ID, deps);
    expect(fetch).toHaveBeenLastCalledWith(`/api/v1/deliveries/${VALID_DELIVERY_ID}`);

    await handleDeliveryHistoryGet(VALID_DELIVERY_ID, deps);
    expect(fetch).toHaveBeenLastCalledWith(
      `/api/v1/admin/deliveries/${VALID_DELIVERY_ID}/history`,
    );

    await handleDeliveryOrchestrationGet(VALID_DELIVERY_ID, deps);
    expect(fetch).toHaveBeenLastCalledWith(
      `/api/v1/deliveries/${VALID_DELIVERY_ID}/orchestration`,
    );
  });

  it("preserves backend error status and message without mock fallback", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          {
            success: false,
            error: { message: "You do not have permission to access this resource." },
          },
          403,
        ),
      );
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleDeliveryDetailGet(VALID_DELIVERY_ID, deps);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      error: "You do not have permission to access this resource.",
    });
  });

  it("returns backend unavailable errors from the proxy layer", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { success: false, error: { message: "BACKEND_API_URL is not configured." } },
          503,
        ),
      );
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleDeliveryListGet(
      new Request("http://localhost/api/deliveries"),
      deps,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      success: false,
      error: "BACKEND_API_URL is not configured.",
    });
  });
});
