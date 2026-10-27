import { describe, expect, it, vi } from "vitest";
import { parseBackendJson } from "../../admin-panel/src/lib/backendClient.ts";
import { shouldClearAdminSessionOnBackendResponse } from "../../admin-panel/src/lib/auth/sessionFromBackend.ts";
import { ACCESS_TOKEN_COOKIE } from "../../admin-panel/src/lib/auth/constants.ts";
import { proxyBackendJsonGet } from "../../admin-panel/src/lib/bff/proxyBackendJson.ts";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setCookieHeader(response: Response): string | null {
  if (typeof response.headers.getSetCookie === "function") {
    const cookies = response.headers.getSetCookie();
    return cookies.length > 0 ? cookies.join(", ") : null;
  }
  return response.headers.get("set-cookie");
}

function expectsSessionClear(setCookie: string | null): boolean {
  if (!setCookie) return false;
  return (
    setCookie.includes(`${ACCESS_TOKEN_COOKIE}=`) &&
    (setCookie.includes("Max-Age=0") || setCookie.includes(`${ACCESS_TOKEN_COOKIE}=;`))
  );
}

describe("admin-panel sessionFromBackend", () => {
  it("clears session only for 401 with invalid-session error codes", () => {
    const invalidToken = jsonResponse(
      {
        success: false,
        error: {
          code: "INVALID_ACCESS_TOKEN",
          message: "Invalid or expired access token.",
        },
      },
      401,
    );
    expect(
      shouldClearAdminSessionOnBackendResponse(invalidToken, {
        error: { code: "INVALID_ACCESS_TOKEN" },
      }),
    ).toBe(true);

    const unauthorized = jsonResponse(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Authentication required." },
      },
      401,
    );
    expect(
      shouldClearAdminSessionOnBackendResponse(unauthorized, {
        error: { code: "UNAUTHORIZED" },
      }),
    ).toBe(true);
  });

  it("does not clear session for 403 or 401 without recognized codes", () => {
    const forbidden = jsonResponse(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "You do not have permission." },
      },
      403,
    );
    expect(
      shouldClearAdminSessionOnBackendResponse(forbidden, {
        error: { code: "FORBIDDEN" },
      }),
    ).toBe(false);

    const unknown401 = jsonResponse(
      { success: false, error: { code: "VALIDATION_ERROR", message: "Bad request." } },
      401,
    );
    expect(
      shouldClearAdminSessionOnBackendResponse(unknown401, {
        error: { code: "VALIDATION_ERROR" },
      }),
    ).toBe(false);

    const noCode = jsonResponse(
      { success: false, error: { message: "Unauthorized" } },
      401,
    );
    expect(
      shouldClearAdminSessionOnBackendResponse(noCode, {
        error: { message: "Unauthorized" },
      }),
    ).toBe(false);
  });

  it("does not clear session for upstream non-auth failures", () => {
    const unavailable = jsonResponse(
      { success: false, error: { code: "INTERNAL_ERROR", message: "Server error." } },
      503,
    );
    expect(
      shouldClearAdminSessionOnBackendResponse(unavailable, {
        error: { code: "INTERNAL_ERROR" },
      }),
    ).toBe(false);
  });
});

describe("admin-panel proxyBackendJson session handling", () => {
  it("clears cookie on backend 401 INVALID_ACCESS_TOKEN", async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: {
            code: "INVALID_ACCESS_TOKEN",
            message: "Invalid or expired access token.",
          },
        },
        401,
      ),
    );
    const response = await proxyBackendJsonGet("/api/v1/admin/customers", "Failed.", {
      fetch,
      parse: parseBackendJson,
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      success: false,
      error: "Invalid or expired access token.",
    });
    expect(expectsSessionClear(setCookieHeader(response))).toBe(true);
  });

  it("preserves 403 without clearing cookie", async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "You do not have permission to access this resource.",
          },
        },
        403,
      ),
    );
    const response = await proxyBackendJsonGet("/api/v1/admin/customers", "Failed.", {
      fetch,
      parse: parseBackendJson,
    });
    expect(response.status).toBe(403);
    expect(setCookieHeader(response)).toBeNull();
  });

  it("preserves 503 without clearing cookie", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { success: false, error: { message: "BACKEND_API_URL is not configured." } },
          503,
        ),
      );
    const response = await proxyBackendJsonGet("/api/v1/admin/customers", "Failed.", {
      fetch,
      parse: parseBackendJson,
    });
    expect(response.status).toBe(503);
    expect(setCookieHeader(response)).toBeNull();
  });
});
