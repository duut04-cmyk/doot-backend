/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("resolveOperationalSmsRecipientMobile", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function resolve(input: string) {
    const mod = await import("../src/infrastructure/sms/sms-recipient.js");
    return mod.resolveOperationalSmsRecipientMobile(input);
  }

  it("returns override digits for pickup and drop when configured in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SMS_OTP_RECIPIENT_OVERRIDE", "918699486836");

    const pickup = await resolve("919888877776");
    const drop = await resolve("919811122233");

    expect(pickup).toEqual({
      recipientMobile: "918699486836",
      overrideApplied: true,
    });
    expect(drop.recipientMobile).toBe("918699486836");
  });

  it("passes through delivery contact when override is unset", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const result = await resolve("919811122233");
    expect(result).toEqual({
      recipientMobile: "919811122233",
      overrideApplied: false,
    });
  });
});
