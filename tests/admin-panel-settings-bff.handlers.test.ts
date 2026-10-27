import { describe, expect, it, vi } from "vitest";
import { parseBackendJson } from "../../admin-panel/src/lib/backendClient.ts";
import { handleSettingsPoliciesPatch } from "../../admin-panel/src/lib/bff/settingsHandlers.ts";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const expectedVersions = {
  quoteMaxAgeSeconds: 0,
  priceTolerancePercent: 0,
  platformServiceFeePercent: 0,
};

describe("admin-panel settings BFF handlers", () => {
  it("forwards valid booking PATCH requests to the backend settings policies path", async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          success: true,
          data: {
            booking: {
              quoteMaxAgeSeconds: {
                value: 600,
                source: "database",
                version: 1,
                restartRequired: false,
              },
              priceTolerancePercent: {
                value: 0,
                source: "env",
                version: 0,
                restartRequired: false,
              },
            },
            pricing: {
              platformServiceFeePercent: {
                value: 10,
                source: "env",
                version: 0,
                restartRequired: false,
              },
            },
            audit: { outcome: "updated", changes: [] },
          },
        },
        200,
      ),
    );
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleSettingsPoliciesPatch(
      new Request("http://localhost/api/settings/policies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking: { quoteMaxAgeSeconds: 600 },
          expectedVersions,
        }),
      }),
      deps,
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    const [path, init] = fetch.mock.calls[0]!;
    expect(path).toBe("/api/v1/admin/settings/policies");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({
      booking: { quoteMaxAgeSeconds: 600 },
      expectedVersions,
    });
    expect(response.status).toBe(200);
  });

  it("forwards pricing-only PATCH with platformServiceFeePercent expected version", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: {} }, 200));
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleSettingsPoliciesPatch(
      new Request("http://localhost/api/settings/policies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pricing: { platformServiceFeePercent: 12 },
          expectedVersions,
        }),
      }),
      deps,
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    const [path, init] = fetch.mock.calls[0]!;
    expect(path).toBe("/api/v1/admin/settings/policies");
    expect(JSON.parse(String(init?.body))).toEqual({
      pricing: { platformServiceFeePercent: 12 },
      expectedVersions,
    });
    expect(response.status).toBe(200);
  });

  it("rejects unknown booking fields before calling the backend", async () => {
    const fetch = vi.fn();
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleSettingsPoliciesPatch(
      new Request("http://localhost/api/settings/policies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking: { nodeEnv: "production" },
          expectedVersions,
        }),
      }),
      deps,
    );

    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects unknown pricing fields before calling the backend", async () => {
    const fetch = vi.fn();
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleSettingsPoliciesPatch(
      new Request("http://localhost/api/settings/policies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pricing: { gstPercent: 18 },
          expectedVersions,
        }),
      }),
      deps,
    );

    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects fractional platform service fee before calling the backend", async () => {
    const fetch = vi.fn();
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleSettingsPoliciesPatch(
      new Request("http://localhost/api/settings/policies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pricing: { platformServiceFeePercent: 10.5 },
          expectedVersions,
        }),
      }),
      deps,
    );

    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves backend error status and message", async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: {
            message:
              "Booking policy settings were updated elsewhere. Refresh and retry.",
          },
        },
        409,
      ),
    );
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleSettingsPoliciesPatch(
      new Request("http://localhost/api/settings/policies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking: { quoteMaxAgeSeconds: 600 },
          expectedVersions,
        }),
      }),
      deps,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      success: false,
      error: "Booking policy settings were updated elsewhere. Refresh and retry.",
    });
  });
});
