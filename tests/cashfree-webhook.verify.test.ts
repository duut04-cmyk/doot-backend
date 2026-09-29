import { describe, expect, it } from "vitest";
import {
  computeCashfreeWebhookSignature,
  verifyCashfreeWebhookSignature,
} from "../src/modules/payment/gateways/cashfree/cashfree-webhook.verify.js";

const secret = "test-cashfree-secret-key";
const timestamp = "1746427759733";
const rawBody =
  '{"type":"PAYMENT_SUCCESS_WEBHOOK","data":{"order":{"order_id":"DOTT-abc"}}}';

describe("Cashfree webhook signature verification", () => {
  it("computes valid signature", () => {
    const signature = computeCashfreeWebhookSignature({
      timestamp,
      rawBody,
      secretKey: secret,
    });
    expect(
      verifyCashfreeWebhookSignature({
        timestamp,
        signature,
        rawBody,
        secretKey: secret,
      }),
    ).toBe(true);
  });

  it("rejects invalid signature", () => {
    expect(
      verifyCashfreeWebhookSignature({
        timestamp,
        signature: "invalid",
        rawBody,
        secretKey: secret,
      }),
    ).toBe(false);
  });

  it("rejects missing signature", () => {
    expect(
      verifyCashfreeWebhookSignature({
        timestamp,
        signature: undefined,
        rawBody,
        secretKey: secret,
      }),
    ).toBe(false);
  });

  it("rejects missing timestamp", () => {
    const signature = computeCashfreeWebhookSignature({
      timestamp,
      rawBody,
      secretKey: secret,
    });
    expect(
      verifyCashfreeWebhookSignature({
        timestamp: undefined,
        signature,
        rawBody,
        secretKey: secret,
      }),
    ).toBe(false);
  });

  it("rejects tampered payload", () => {
    const signature = computeCashfreeWebhookSignature({
      timestamp,
      rawBody,
      secretKey: secret,
    });
    expect(
      verifyCashfreeWebhookSignature({
        timestamp,
        signature,
        rawBody: `${rawBody} `,
        secretKey: secret,
      }),
    ).toBe(false);
  });
});
