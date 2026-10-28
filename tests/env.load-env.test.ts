/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("loadEnv startup validation", () => {
  const envSnapshot: NodeJS.ProcessEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
    vi.resetModules();
  });

  it("throws before env export when production configuration is invalid", async () => {
    process.env = {
      ...envSnapshot,
      NODE_ENV: "production",
      JWT_ACCESS_SECRET: "x".repeat(32),
      PAYMENT_GATEWAY: "stub",
    };

    await expect(import("../src/config/env.js")).rejects.toThrow(
      /Invalid environment configuration/,
    );
  });
});
