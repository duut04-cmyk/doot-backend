import { describe, expect, it } from "vitest";
import {
  createBorzoWebhookSignature,
  verifyBorzoWebhookSignature,
} from "../src/modules/provider/adapters/borzo/borzo.webhook.signature.js";

describe("Borzo webhook signature", () => {
  const secret = "test-borzo-callback-secret-min-16-chars";

  it("verifies a valid signature against the exact raw body", () => {
    const rawBody = Buffer.from(
      '{"event_type":"order_created","event_datetime":"2026-09-14T12:57:09+05:30"}',
      "utf8",
    );
    const signature = createBorzoWebhookSignature(rawBody, secret);
    expect(
      verifyBorzoWebhookSignature({
        rawBody,
        signatureHeader: signature,
        secret,
      }),
    ).toBe(true);
  });

  it("rejects modified raw body", () => {
    const rawBody = Buffer.from('{"event_type":"order_created"}', "utf8");
    const tampered = Buffer.from('{"event_type":"order_changed"}', "utf8");
    const signature = createBorzoWebhookSignature(rawBody, secret);
    expect(
      verifyBorzoWebhookSignature({
        rawBody: tampered,
        signatureHeader: signature,
        secret,
      }),
    ).toBe(false);
  });

  it("rejects whitespace differences in raw JSON", () => {
    const compact = Buffer.from('{"a":1}', "utf8");
    const spaced = Buffer.from('{ "a": 1 }', "utf8");
    const signature = createBorzoWebhookSignature(compact, secret);
    expect(
      verifyBorzoWebhookSignature({
        rawBody: spaced,
        signatureHeader: signature,
        secret,
      }),
    ).toBe(false);
  });

  it("rejects missing signature header", () => {
    const rawBody = Buffer.from("{}", "utf8");
    expect(
      verifyBorzoWebhookSignature({
        rawBody,
        signatureHeader: undefined,
        secret,
      }),
    ).toBe(false);
  });
});
