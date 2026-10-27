import { describe, expect, it, vi } from "vitest";
import { parseBackendJson } from "../../admin-panel/src/lib/backendClient.ts";
import {
  handleProviderDetailGet,
  handleProviderDetailPatch,
  handleProviderCapabilitiesPut,
  handleProviderCredentialsPut,
  handleProviderTestConnectionPost,
  handleProviderStatusPatch,
  handleProviderServicesListGet,
  handleProviderServiceCreatePost,
  handleProviderServiceUpdatePatch,
  handleProviderVehiclesListGet,
  handleProviderVehicleCreatePost,
  handleProviderVehicleUpdatePatch,
} from "../../admin-panel/src/lib/bff/providerHandlers.ts";
import {
  isProviderCredentialsMetadataOnly,
  providerDetailPayloadOmitsSecretKeys,
} from "../../admin-panel/src/providers/providerDetailContract.ts";
import type { ProviderDetail } from "../../admin-panel/src/data/providerTypes.ts";

const VALID_PROVIDER_ID = "00000000-0000-4000-8000-000000000010";
const VALID_SUB_RESOURCE_ID = "00000000-0000-4000-8000-000000000011";

const sampleService = {
  id: VALID_SUB_RESOURCE_ID,
  code: "EXPRESS_BIKE",
  name: "Express bike",
  serviceType: "EXPRESS",
  description: null,
  enabled: true,
  priority: 100,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const sampleVehicle = {
  id: VALID_SUB_RESOURCE_ID,
  vehicleType: "BIKE",
  enabled: true,
  maxWeightKg: 10,
  maxLengthCm: null,
  maxWidthCm: null,
  maxHeightCm: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const sampleProviderDetail: ProviderDetail = {
  id: VALID_PROVIDER_ID,
  code: "MOCK",
  name: "Mock Provider",
  displayName: "Mock",
  description: "Test provider",
  environment: "SANDBOX",
  status: "ACTIVE",
  enabled: true,
  orchestrationEnabled: false,
  priority: 100,
  integrationStatus: "CONFIGURED",
  orchestrationEligible: false,
  health: {
    status: "UNKNOWN",
    lastCheckedAt: null,
    lastError: null,
  },
  credentials: {
    configured: true,
    fields: [
      { name: "API_KEY", configured: true },
      { name: "API_SECRET", configured: false },
    ],
  },
  capabilities: ["SERVICEABILITY", "BOOKING"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  settings: {
    timeoutMs: 30000,
    connectTimeoutMs: 10000,
    maxRetries: 2,
    retryDelayMs: 1000,
    webhookEnabled: false,
    healthCheckEnabled: true,
    healthCheckIntervalMs: 300000,
  },
  packageLimits: null,
  services: [],
  vehicles: [],
};

describe("admin-panel provider BFF handlers", () => {
  it("rejects malformed provider ids before calling the backend", async () => {
    const fetch = vi.fn();
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleProviderDetailGet("not-a-uuid", deps);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: "Invalid provider id.",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards detail requests to the admin providers backend path", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ success: true, data: sampleProviderDetail }, 200),
      );
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleProviderDetailGet(VALID_PROVIDER_ID, deps);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`/api/v1/admin/providers/${VALID_PROVIDER_ID}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.code).toBe("MOCK");
  });

  it("preserves backend unauthorized errors without mock fallback", async () => {
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

    const response = await handleProviderDetailGet(VALID_PROVIDER_ID, deps);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      error: "You do not have permission to access this resource.",
    });
  });

  it("preserves backend not-found errors", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { success: false, error: { message: "Provider not found." } },
          404,
        ),
      );
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleProviderDetailGet(VALID_PROVIDER_ID, deps);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      success: false,
      error: "Provider not found.",
    });
  });

  it("rejects malformed provider ids on PATCH before calling the backend", async () => {
    const fetch = vi.fn();
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleProviderDetailPatch("bad-id", { priority: 1 }, deps);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: "Invalid provider id.",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards PATCH to the admin providers backend path", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { success: true, data: { ...sampleProviderDetail, priority: 5 } },
          200,
        ),
      );
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleProviderDetailPatch(
      VALID_PROVIDER_ID,
      { priority: 5 },
      deps,
    );

    expect(fetch).toHaveBeenCalledWith(`/api/v1/admin/providers/${VALID_PROVIDER_ID}`, {
      method: "PATCH",
      body: JSON.stringify({ priority: 5 }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.priority).toBe(5);
  });

  it("preserves backend PATCH unauthorized errors", async () => {
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

    const response = await handleProviderDetailPatch(
      VALID_PROVIDER_ID,
      { priority: 10 },
      deps,
    );
    expect(response.status).toBe(403);
  });

  it("rejects malformed provider ids on capabilities PUT before calling the backend", async () => {
    const fetch = vi.fn();
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleProviderCapabilitiesPut(
      "bad-id",
      { capabilities: ["BOOKING"] },
      deps,
    );
    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards capabilities PUT to the admin providers backend path", async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          success: true,
          data: { ...sampleProviderDetail, capabilities: ["PRICING", "BOOKING"] },
        },
        200,
      ),
    );
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleProviderCapabilitiesPut(
      VALID_PROVIDER_ID,
      { capabilities: ["BOOKING", "PRICING"] },
      deps,
    );

    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/admin/providers/${VALID_PROVIDER_ID}/capabilities`,
      {
        method: "PUT",
        body: JSON.stringify({ capabilities: ["BOOKING", "PRICING"] }),
      },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.capabilities).toEqual(["PRICING", "BOOKING"]);
  });

  it("preserves backend capabilities PUT unauthorized errors", async () => {
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

    const response = await handleProviderCapabilitiesPut(
      VALID_PROVIDER_ID,
      { capabilities: [] },
      deps,
    );
    expect(response.status).toBe(403);
  });

  it("rejects malformed provider ids on status PATCH before calling the backend", async () => {
    const fetch = vi.fn();
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleProviderStatusPatch(
      "bad-id",
      { status: "ACTIVE" },
      deps,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: "Invalid provider id.",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards status PATCH to the admin providers backend path", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          {
            success: true,
            data: { ...sampleProviderDetail, status: "SUSPENDED", enabled: false },
          },
          200,
        ),
      );
    const deps = { fetch, parse: parseBackendJson };

    const body = { status: "SUSPENDED" as const, enabled: false };
    const response = await handleProviderStatusPatch(VALID_PROVIDER_ID, body, deps);

    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/admin/providers/${VALID_PROVIDER_ID}/status`,
      { method: "PATCH", body: JSON.stringify(body) },
    );
    expect(response.status).toBe(200);
    const parsed = await response.json();
    expect(parsed.data.status).toBe("SUSPENDED");
    expect(parsed.data.enabled).toBe(false);
  });

  it("preserves backend status PATCH unauthorized errors", async () => {
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

    const response = await handleProviderStatusPatch(
      VALID_PROVIDER_ID,
      { status: "INACTIVE" },
      deps,
    );
    expect(response.status).toBe(403);
  });

  it("rejects malformed provider ids on test-connection POST before calling the backend", async () => {
    const fetch = vi.fn();
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleProviderTestConnectionPost("bad-id", deps);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: "Invalid provider id.",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards test-connection POST to the admin providers backend path", async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          success: true,
          data: {
            providerCode: "MOCK",
            environment: "SANDBOX",
            connected: true,
            latencyMs: 12,
          },
        },
        200,
      ),
    );
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleProviderTestConnectionPost(VALID_PROVIDER_ID, deps);

    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/admin/providers/${VALID_PROVIDER_ID}/test-connection`,
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.connected).toBe(true);
    expect(body.data.latencyMs).toBe(12);
  });

  it("preserves backend test-connection unauthorized errors", async () => {
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

    const response = await handleProviderTestConnectionPost(VALID_PROVIDER_ID, deps);
    expect(response.status).toBe(403);
  });

  it("rejects malformed provider ids on credentials PUT before calling the backend", async () => {
    const fetch = vi.fn();
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleProviderCredentialsPut(
      "bad-id",
      { API_KEY: "test-key" },
      deps,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: "Invalid provider id.",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards credentials PUT to the admin providers backend path", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ success: true, data: { configured: true } }, 200),
      );
    const deps = { fetch, parse: parseBackendJson };

    const body = { API_KEY: "write-only-key" };
    const response = await handleProviderCredentialsPut(VALID_PROVIDER_ID, body, deps);

    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/admin/providers/${VALID_PROVIDER_ID}/credentials`,
      { method: "PUT", body: JSON.stringify(body) },
    );
    expect(response.status).toBe(200);
    const parsed = await response.json();
    expect(parsed.data.configured).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain("write-only-key");
  });

  it("preserves backend credentials PUT unauthorized errors", async () => {
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

    const response = await handleProviderCredentialsPut(
      VALID_PROVIDER_ID,
      { API_KEY: "x" },
      deps,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      error: "You do not have permission to access this resource.",
    });
  });

  it("rejects malformed service ids on PATCH before calling the backend", async () => {
    const fetch = vi.fn();
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleProviderServiceUpdatePatch(
      VALID_PROVIDER_ID,
      "not-a-uuid",
      { enabled: false },
      deps,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: "Invalid resource id.",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards services list GET to the admin providers backend path", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: [sampleService] }, 200));
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleProviderServicesListGet(VALID_PROVIDER_ID, deps);

    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/admin/providers/${VALID_PROVIDER_ID}/services`,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].code).toBe("EXPRESS_BIKE");
  });

  it("forwards service POST to the admin providers backend path", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: sampleService }, 201));
    const deps = { fetch, parse: parseBackendJson };

    const payload = {
      code: "EXPRESS_BIKE",
      name: "Express bike",
      serviceType: "EXPRESS" as const,
      priority: 100,
    };

    const response = await handleProviderServiceCreatePost(
      VALID_PROVIDER_ID,
      payload,
      deps,
    );

    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/admin/providers/${VALID_PROVIDER_ID}/services`,
      { method: "POST", body: JSON.stringify(payload) },
    );
    expect(response.status).toBe(201);
  });

  it("forwards service PATCH to the admin providers backend path", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { success: true, data: { ...sampleService, enabled: false } },
          200,
        ),
      );
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleProviderServiceUpdatePatch(
      VALID_PROVIDER_ID,
      VALID_SUB_RESOURCE_ID,
      { enabled: false },
      deps,
    );

    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/admin/providers/${VALID_PROVIDER_ID}/services/${VALID_SUB_RESOURCE_ID}`,
      { method: "PATCH", body: JSON.stringify({ enabled: false }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.enabled).toBe(false);
  });

  it("forwards vehicles list GET to the admin providers backend path", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: [sampleVehicle] }, 200));
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleProviderVehiclesListGet(VALID_PROVIDER_ID, deps);

    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/admin/providers/${VALID_PROVIDER_ID}/vehicles`,
    );
    expect(response.status).toBe(200);
  });

  it("forwards vehicle POST to the admin providers backend path", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: sampleVehicle }, 201));
    const deps = { fetch, parse: parseBackendJson };

    const payload = { vehicleType: "BIKE" as const, enabled: true, maxWeightKg: 10 };

    const response = await handleProviderVehicleCreatePost(
      VALID_PROVIDER_ID,
      payload,
      deps,
    );

    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/admin/providers/${VALID_PROVIDER_ID}/vehicles`,
      { method: "POST", body: JSON.stringify(payload) },
    );
    expect(response.status).toBe(201);
  });

  it("forwards vehicle PATCH to the admin providers backend path", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { success: true, data: { ...sampleVehicle, maxWeightKg: 20 } },
          200,
        ),
      );
    const deps = { fetch, parse: parseBackendJson };

    const response = await handleProviderVehicleUpdatePatch(
      VALID_PROVIDER_ID,
      VALID_SUB_RESOURCE_ID,
      { maxWeightKg: 20 },
      deps,
    );

    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/admin/providers/${VALID_PROVIDER_ID}/vehicles/${VALID_SUB_RESOURCE_ID}`,
      { method: "PATCH", body: JSON.stringify({ maxWeightKg: 20 }) },
    );
    expect(response.status).toBe(200);
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

    const response = await handleProviderDetailGet(VALID_PROVIDER_ID, deps);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      success: false,
      error: "BACKEND_API_URL is not configured.",
    });
  });
});

describe("admin-panel provider detail UI contract", () => {
  it("accepts credential metadata without secret values", () => {
    expect(isProviderCredentialsMetadataOnly(sampleProviderDetail.credentials)).toBe(
      true,
    );
    expect(providerDetailPayloadOmitsSecretKeys(sampleProviderDetail)).toBe(true);
  });

  it("rejects payloads that echo credential secret keys", () => {
    const unsafe = {
      ...sampleProviderDetail,
      credentials: {
        configured: true,
        fields: [{ name: "API_KEY", configured: true, value: "secret" }],
      },
    };
    expect(isProviderCredentialsMetadataOnly(unsafe.credentials)).toBe(false);
    expect(
      providerDetailPayloadOmitsSecretKeys({ API_KEY: "super-secret-value" }),
    ).toBe(false);
  });

  it("allows empty services, vehicles, and capabilities", () => {
    const emptyCollections: ProviderDetail = {
      ...sampleProviderDetail,
      capabilities: [],
      services: [],
      vehicles: [],
    };
    expect(emptyCollections.services).toHaveLength(0);
    expect(providerDetailPayloadOmitsSecretKeys(emptyCollections)).toBe(true);
  });
});
