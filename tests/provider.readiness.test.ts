import { describe, expect, it } from "vitest";
import {
  canMarkProviderReady,
  computeIntegrationStatus,
  computeIntegrationStatusWithAdapter,
} from "../src/modules/provider/provider.readiness.js";

describe("Provider readiness (Phase 3 extensions)", () => {
  it("keeps Phase 2 CONFIGURED baseline without adapter", () => {
    const status = computeIntegrationStatus({
      provider: { enabled: true },
      activeCredentials: [{ id: "1" } as never],
      capabilities: [{ capability: "BOOKING" } as never],
    });
    expect(status).toBe("CONFIGURED");
  });

  it("does not mark READY without healthy status", () => {
    const status = computeIntegrationStatusWithAdapter({
      provider: { enabled: true },
      activeCredentials: [{ id: "1" } as never],
      capabilities: [{ capability: "BOOKING" } as never],
      adapterRegistered: true,
      healthStatus: "UNKNOWN",
    });
    expect(status).toBe("CONFIGURED");
  });

  it("marks READY only when all conditions are met", () => {
    expect(
      canMarkProviderReady({
        enabled: true,
        hasCredentials: true,
        hasCapabilities: true,
        adapterRegistered: true,
        healthStatus: "HEALTHY",
      }),
    ).toBe(true);

    const status = computeIntegrationStatusWithAdapter({
      provider: { enabled: true },
      activeCredentials: [{ id: "1" } as never],
      capabilities: [{ capability: "BOOKING" } as never],
      adapterRegistered: true,
      healthStatus: "HEALTHY",
    });
    expect(status).toBe("READY");
  });
});
