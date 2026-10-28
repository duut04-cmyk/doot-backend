import { afterEach, describe, expect, it, vi } from "vitest";

describe("test SMS endpoint config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults to disabled in test environment", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ENABLE_TEST_SMS_ENDPOINT", "");
    const { isTestSmsEndpointEnabled } =
      await import("../src/modules/test-sms/test-sms.config.js");
    expect(isTestSmsEndpointEnabled()).toBe(false);
  });

  it("enables only when explicitly opted in outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENABLE_TEST_SMS_ENDPOINT", "true");
    const { isTestSmsEndpointEnabled } =
      await import("../src/modules/test-sms/test-sms.config.js");
    expect(isTestSmsEndpointEnabled()).toBe(true);
  });

  it("never enables in production even when env flag is true", async () => {
    vi.resetModules();
    vi.doMock("../src/config/env.js", () => ({
      env: {
        NODE_ENV: "production",
        ENABLE_TEST_SMS_ENDPOINT: true,
      },
    }));
    const { isTestSmsEndpointEnabled } =
      await import("../src/modules/test-sms/test-sms.config.js");
    expect(isTestSmsEndpointEnabled()).toBe(false);
    vi.doUnmock("../src/config/env.js");
  });
});
