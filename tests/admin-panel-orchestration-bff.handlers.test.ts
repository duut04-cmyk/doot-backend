import { describe, expect, it, vi } from "vitest";
import { parseBackendJson } from "../../admin-panel/src/lib/backendClient.ts";
import {
  handleOrchestrationListGet,
  handleOrchestrationRunGet,
} from "../../admin-panel/src/lib/bff/orchestrationHandlers.ts";

const VALID_ORCHESTRATION_ID = "00000000-0000-4000-8000-000000000010";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("admin-panel orchestration BFF handlers", () => {
  it("forwards list requests to the admin orchestrations backend path", async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          success: true,
          data: { items: [], page: 1, limit: 20, total: 0, totalPages: 1 },
        },
        200,
      ),
    );
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleOrchestrationListGet(
      new Request(
        "http://localhost/api/orchestrations?page=3&limit=5&foo=bar&reference=DOOT",
      ),
      deps,
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/admin/orchestrations?page=3&limit=5&reference=DOOT",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { total: 0 } });
  });

  it("rejects invalid orchestration ids before calling the backend", async () => {
    const fetch = vi.fn();
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleOrchestrationRunGet("not-a-uuid", deps);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: "Invalid orchestration id.",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards run detail requests to the admin orchestrations backend path", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { success: true, data: { orchestration: { id: VALID_ORCHESTRATION_ID } } },
          200,
        ),
      );
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleOrchestrationRunGet(VALID_ORCHESTRATION_ID, deps);
    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/admin/orchestrations/${VALID_ORCHESTRATION_ID}`,
    );
    expect(response.status).toBe(200);
  });

  it("preserves backend error status and message without mock fallback", async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: { message: "You do not have permission to access this resource." },
        },
        403,
      ),
    );
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleOrchestrationListGet(
      new Request("http://localhost/api/orchestrations"),
      deps,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      error: "You do not have permission to access this resource.",
    });
  });
});
