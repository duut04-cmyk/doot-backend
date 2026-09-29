import { describe, expect, it } from "vitest";
import { normalizeCashfreePaymentWebhook } from "../src/modules/payment/gateways/cashfree/cashfree-webhook.normalize.js";

describe("Cashfree webhook normalization", () => {
  it("normalizes payment success", () => {
    const event = normalizeCashfreePaymentWebhook({
      payload: {
        type: "PAYMENT_SUCCESS_WEBHOOK",
        data: {
          order: { order_id: "DOTT-1", order_amount: 120.5, order_currency: "INR" },
          payment: {
            cf_payment_id: "cf-pay-1",
            payment_status: "SUCCESS",
            payment_amount: 120.5,
            payment_group: "upi",
          },
        },
      },
      headerIdempotencyKey: "idem-1",
    });
    expect(event?.eventType).toBe("PAYMENT_SUCCESS");
    expect(event?.gatewayOrderId).toBe("DOTT-1");
    expect(event?.gatewayPaymentId).toBe("cf-pay-1");
    expect(event?.idempotencyKey).toBe("idem-1");
  });

  it("normalizes failed and pending", () => {
    expect(
      normalizeCashfreePaymentWebhook({
        payload: {
          data: {
            order: { order_id: "DOTT-2" },
            payment: { payment_status: "FAILED" },
          },
        },
      })?.eventType,
    ).toBe("PAYMENT_FAILED");

    expect(
      normalizeCashfreePaymentWebhook({
        payload: {
          data: {
            order: { order_id: "DOTT-3" },
            payment: { payment_status: "PENDING" },
          },
        },
      })?.eventType,
    ).toBe("PAYMENT_PENDING");
  });

  it("returns null when order id missing", () => {
    expect(
      normalizeCashfreePaymentWebhook({
        payload: { data: { payment: { payment_status: "SUCCESS" } } },
      }),
    ).toBeNull();
  });
});
