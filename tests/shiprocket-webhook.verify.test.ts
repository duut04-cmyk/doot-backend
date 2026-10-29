import { describe, expect, it } from "vitest";
import { verifyShiprocketWebhookApiKey } from "../src/modules/provider/adapters/shiprocket/shiprocket-webhook.verify.js";

describe("verifyShiprocketWebhookApiKey", () => {
  it("accepts matching keys", () => {
    expect(
      verifyShiprocketWebhookApiKey({
        suppliedKey: "secret-key",
        configuredKey: "secret-key",
      }),
    ).toBe(true);
  });

  it("rejects missing supplied key", () => {
    expect(
      verifyShiprocketWebhookApiKey({
        suppliedKey: undefined,
        configuredKey: "secret-key",
      }),
    ).toBe(false);
  });

  it("rejects incorrect key", () => {
    expect(
      verifyShiprocketWebhookApiKey({
        suppliedKey: "wrong-key",
        configuredKey: "secret-key",
      }),
    ).toBe(false);
  });

  it("rejects different-length keys without throwing", () => {
    expect(
      verifyShiprocketWebhookApiKey({
        suppliedKey: "short",
        configuredKey: "much-longer-secret",
      }),
    ).toBe(false);
  });
});
