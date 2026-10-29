import { describe, expect, it } from "vitest";
import { resolveOrderShowProbeResult } from "../src/modules/provider/adapters/shiprocket/shiprocket-order-show.probe.js";
import { ProviderAdapterError } from "../src/modules/provider/contracts/provider-error.js";

describe("Shiprocket orders/show probe", () => {
  const ctx = {
    operation: "getBooking" as const,
    requestId: "req-probe-1",
  };

  it("returns null only for HTTP 404", () => {
    expect(
      resolveOrderShowProbeResult({
        status: 404,
        data: {},
        ...ctx,
      }),
    ).toBeNull();
  });

  it("throws non-retryable error for HTTP 498", () => {
    expect(() =>
      resolveOrderShowProbeResult({
        status: 498,
        data: {},
        ...ctx,
      }),
    ).toThrow(ProviderAdapterError);
    try {
      resolveOrderShowProbeResult({ status: 498, data: {}, ...ctx });
    } catch (error) {
      expect(error).toMatchObject({
        category: "PROVIDER_SERVICE_UNAVAILABLE",
      });
    }
  });

  it("throws rate limited error for HTTP 429", () => {
    try {
      resolveOrderShowProbeResult({ status: 429, data: {}, ...ctx });
    } catch (error) {
      expect(error).toMatchObject({
        category: "PROVIDER_RATE_LIMITED",
      });
    }
  });

  it("throws authentication error for HTTP 401", () => {
    try {
      resolveOrderShowProbeResult({ status: 401, data: {}, ...ctx });
    } catch (error) {
      expect(error).toMatchObject({
        category: "PROVIDER_AUTHENTICATION_ERROR",
      });
    }
  });

  it("throws for ambiguous 200 without parseable order body", () => {
    try {
      resolveOrderShowProbeResult({ status: 200, data: { data: {} }, ...ctx });
    } catch (error) {
      expect(error).toMatchObject({
        category: "PROVIDER_UNKNOWN_ERROR",
      });
    }
  });
});
