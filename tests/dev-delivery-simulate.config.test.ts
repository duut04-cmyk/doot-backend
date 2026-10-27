/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("dev-delivery-simulate.config", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    delete process.env.ENABLE_DEV_DELIVERY_SIMULATE;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.ENABLE_DEV_DELIVERY_SIMULATE;
  });

  async function loadConfig() {
    const mod =
      await import("../src/modules/dev-delivery-simulate/dev-delivery-simulate.config.js");
    return mod.isDevDeliverySimulateEnabled;
  }

  it("is disabled by default", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENABLE_DEV_DELIVERY_SIMULATE", "false");
    const isEnabled = await loadConfig();
    expect(isEnabled()).toBe(false);
  });

  it("is enabled in development when ENABLE_DEV_DELIVERY_SIMULATE is true", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENABLE_DEV_DELIVERY_SIMULATE", "true");
    const isEnabled = await loadConfig();
    expect(isEnabled()).toBe(true);
  });

  it("is enabled in production when ENABLE_DEV_DELIVERY_SIMULATE is true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_DEV_DELIVERY_SIMULATE", "true");
    const isEnabled = await loadConfig();
    expect(isEnabled()).toBe(true);
  });
});
