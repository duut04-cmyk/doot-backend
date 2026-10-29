import { describe, expect, it, vi } from "vitest";
import {
  assertSandboxNumericOrderId,
  maskIdentifier,
  runShiprocketSandboxCancelVerify,
  sanitizeSandboxCancelArtifact,
  SHIPROCKET_SANDBOX_CANCEL_CONFIRM_PHRASE,
} from "../src/modules/provider/adapters/shiprocket/shiprocket-sandbox-cancel-verify.js";
import {
  assertShiprocketSandboxHttpsBaseUrl,
  ShiprocketSandboxProbeError,
} from "../src/modules/provider/adapters/shiprocket/shiprocket-sandbox-probe.js";
import type { ProviderHttpClient } from "../src/modules/provider/adapters/provider-http-client.js";
import { ShiprocketAuthService } from "../src/modules/provider/adapters/shiprocket/shiprocket-auth.service.js";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("shiprocket sandbox cancel verify", () => {
  it("rejects non-numeric order ids", () => {
    expect(() => assertSandboxNumericOrderId("channel-order")).toThrow(
      ShiprocketSandboxProbeError,
    );
  });

  it("masks identifiers for artifacts", () => {
    expect(maskIdentifier("16161616")).toMatch(/\*\*\*/);
    const sanitized = sanitizeSandboxCancelArtifact({
      data: {
        id: 16161616,
        awb_code: "SR123456789IN",
        token: "secret",
        billing_address: "123 Secret Street",
      },
    }) as {
      data: {
        id: string;
        awb_code: string;
        token: string;
        billing_address: string;
      };
    };
    expect(sanitized.data.token).toBe("[redacted]");
    expect(sanitized.data.awb_code).toMatch(/\*\*\*/);
    expect(sanitized.data.billing_address).toMatch(/\*\*\*/);
  });

  it("rejects production Shiprocket host", () => {
    expect(() =>
      assertShiprocketSandboxHttpsBaseUrl("https://apiv2.shiprocket.in"),
    ).toThrow(ShiprocketSandboxProbeError);
  });

  it("requires confirm phrase for cancel phase", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sr-cancel-verify-"));
    await expect(
      runShiprocketSandboxCancelVerify({
        baseUrl: "https://api-sandbox.shiprocket.in",
        orderId: "16161616",
        phase: "cancel",
        runDir: dir,
        auth: {
          getBearerToken: async () => "token",
        } as unknown as ShiprocketAuthService,
        http: { request: vi.fn() } as unknown as ProviderHttpClient,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("read phase does not POST cancel", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sr-cancel-verify-"));
    const request = vi.fn(
      async (input: { request: { method: string; path: string } }) => {
        if (input.request.path.includes("/orders/show/")) {
          return {
            status: 200,
            data: {
              data: {
                id: 16161616,
                status: "NEW",
                awb_code: "SR123456789IN",
                shipments: [{ id: 15151515 }],
              },
            },
            headers: {},
            durationMs: 1,
          };
        }
        if (input.request.path.includes("/courier/track/")) {
          return { status: 200, data: { tracking: [] }, headers: {}, durationMs: 1 };
        }
        return { status: 404, data: {}, headers: {}, durationMs: 1 };
      },
    );

    const result = await runShiprocketSandboxCancelVerify({
      baseUrl: "https://api-sandbox.shiprocket.in",
      orderId: "16161616",
      phase: "read",
      runDir: dir,
      auth: { getBearerToken: async () => "token" } as unknown as ShiprocketAuthService,
      http: { request } as unknown as ProviderHttpClient,
    });

    expect(result.orderShow?.httpStatus).toBe(200);
    expect(result.cancel).toBeUndefined();
    const paths = request.mock.calls.map((call) => call[0].request.path);
    expect(paths.some((path) => path.includes("/orders/cancel"))).toBe(false);
  });

  it("cancel phase POSTs once with confirm phrase", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sr-cancel-verify-"));
    const request = vi.fn(
      async (input: { request: { method: string; path: string; body?: unknown } }) => {
        if (input.request.path.includes("/orders/show/")) {
          return {
            status: 200,
            data: { data: { id: 16161616, status: "NEW" } },
            headers: {},
            durationMs: 1,
          };
        }
        if (input.request.path === "/v1/external/orders/cancel") {
          return { status: 204, data: {}, headers: {}, durationMs: 1 };
        }
        return { status: 404, data: {}, headers: {}, durationMs: 1 };
      },
    );

    const result = await runShiprocketSandboxCancelVerify({
      baseUrl: "https://api-sandbox.shiprocket.in",
      orderId: "16161616",
      phase: "cancel",
      confirmCancel: SHIPROCKET_SANDBOX_CANCEL_CONFIRM_PHRASE,
      runDir: dir,
      auth: { getBearerToken: async () => "token" } as unknown as ShiprocketAuthService,
      http: { request } as unknown as ProviderHttpClient,
    });

    expect(result.cancel?.httpStatus).toBe(204);
    const cancelCalls = request.mock.calls.filter(
      (call) => call[0].request.path === "/v1/external/orders/cancel",
    );
    expect(cancelCalls).toHaveLength(1);
    expect(cancelCalls[0]?.[0].request.body).toEqual({ ids: [16161616] });
  });

  it("reconcile phase does not POST cancel", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sr-cancel-verify-"));
    const request = vi.fn(async (input: { request: { path: string } }) => {
      if (input.request.path.includes("/orders/show/")) {
        return {
          status: 200,
          data: { data: { id: 16161616, status: "CANCELLED" } },
          headers: {},
          durationMs: 1,
        };
      }
      return { status: 404, data: {}, headers: {}, durationMs: 1 };
    });

    await runShiprocketSandboxCancelVerify({
      baseUrl: "https://api-sandbox.shiprocket.in",
      orderId: "16161616",
      phase: "reconcile",
      runDir: dir,
      auth: { getBearerToken: async () => "token" } as unknown as ShiprocketAuthService,
      http: { request } as unknown as ProviderHttpClient,
    });

    const paths = request.mock.calls.map((call) => call[0].request.path);
    expect(paths.some((path) => path.includes("/orders/cancel"))).toBe(false);
  });
});
