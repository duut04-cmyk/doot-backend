import { describe, expect, it } from "vitest";
import {
  normalizeCashfreePaymentWebhook,
  resolveCashfreePaymentWebhook,
} from "../src/modules/payment/gateways/cashfree/cashfree-webhook.normalize.js";

describe("Cashfree webhook normalization", () => {
  it("normalizes payment success", () => {
    const event = normalizeCashfreePaymentWebhook({
      payload: {
        type: "PAYMENT_SUCCESS_WEBHOOK",
        data: {
          order: { order_id: "DOOT-1", order_amount: 120.5, order_currency: "INR" },
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
    expect(event?.gatewayOrderId).toBe("DOOT-1");
    expect(event?.gatewayPaymentId).toBe("cf-pay-1");
    expect(event?.idempotencyKey).toBe("idem-1");
  });

  it("normalizes failed and pending", () => {
    expect(
      normalizeCashfreePaymentWebhook({
        payload: {
          data: {
            order: { order_id: "DOOT-2" },
            payment: { payment_status: "FAILED" },
          },
        },
      })?.eventType,
    ).toBe("PAYMENT_FAILED");

    expect(
      normalizeCashfreePaymentWebhook({
        payload: {
          data: {
            order: { order_id: "DOOT-3" },
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

  it("normalizes refund success and failed webhooks", () => {
    const success = normalizeCashfreePaymentWebhook({
      payload: {
        type: "REFUND_STATUS_WEBHOOK",
        data: {
          order: { order_id: "DOOT-R1" },
          refund: {
            refund_id: "merchantRefund1",
            cf_refund_id: "cf-refund-1",
            refund_status: "SUCCESS",
            refund_amount: 50,
            refund_currency: "INR",
          },
        },
      },
    });
    expect(success?.eventType).toBe("REFUND_SUCCESS");
    expect(success?.gatewayOrderId).toBe("DOOT-R1");
    expect(success?.gatewayRefundId).toBe("merchantRefund1");
    expect(success?.amount).toBe(50);

    const failed = normalizeCashfreePaymentWebhook({
      payload: {
        type: "REFUND_FAILED_WEBHOOK",
        data: {
          order: { order_id: "DOOT-R2" },
          refund: {
            refund_id: "merchantRefund2",
            refund_status: "FAILED",
            refund_amount: 20,
          },
        },
      },
    });
    expect(failed?.eventType).toBe("REFUND_FAILED");
  });

  it("maps USER_DROPPED webhook type to PAYMENT_FAILED", () => {
    const resolved = resolveCashfreePaymentWebhook({
      payload: {
        type: "PAYMENT_USER_DROPPED_WEBHOOK",
        data: {
          order: { order_id: "DOOT-UD" },
          payment: { payment_status: "USER_DROPPED" },
        },
      },
    });
    expect(resolved.action).toBe("process");
    if (resolved.action === "process") {
      expect(resolved.event.eventType).toBe("PAYMENT_FAILED");
    }
  });

  it("ignores PAYMENT_CHARGES_WEBHOOK", () => {
    const resolved = resolveCashfreePaymentWebhook({
      payload: {
        type: "PAYMENT_CHARGES_WEBHOOK",
        data: {
          order: { order_id: "DOOT-CH" },
          payment: { payment_status: "SUCCESS", cf_payment_id: "1" },
        },
      },
    });
    expect(resolved).toMatchObject({
      action: "ignore",
      reason: "payment_charges_or_non_lifecycle_event",
    });
  });

  it("ignores unsupported webhook type with order present", () => {
    const resolved = resolveCashfreePaymentWebhook({
      payload: {
        type: "SETTLEMENT_INITIATED_WEBHOOK",
        data: {
          order: { order_id: "DOOT-X" },
        },
      },
    });
    expect(resolved).toMatchObject({
      action: "ignore",
      reason: "unsupported_webhook_type",
    });
  });

  it("ignores REFUND_STATUS_WEBHOOK when refund is PENDING", () => {
    const resolved = resolveCashfreePaymentWebhook({
      payload: {
        type: "REFUND_STATUS_WEBHOOK",
        data: {
          order: { order_id: "DOOT-RP" },
          refund: { refund_status: "PENDING", refund_id: "r1" },
        },
      },
    });
    expect(resolved).toMatchObject({ action: "ignore" });
  });

  it("coerces numeric cf_payment_id", () => {
    const event = normalizeCashfreePaymentWebhook({
      payload: {
        type: "PAYMENT_SUCCESS_WEBHOOK",
        data: {
          order: { order_id: "DOOT-NUM" },
          payment: { cf_payment_id: 9087654321, payment_status: "SUCCESS" },
        },
      },
    });
    expect(event?.gatewayPaymentId).toBe("9087654321");
  });

  it("ignores Cashfree dashboard connectivity ping (type WEBHOOK, no order)", () => {
    const resolved = resolveCashfreePaymentWebhook({
      payload: {
        type: "WEBHOOK",
        event_time: "2026-10-10T06:08:13Z",
        data: {},
      },
    });
    expect(resolved).toMatchObject({
      action: "ignore",
      reason: "unsupported_webhook_type",
    });
    expect(
      resolved.action === "ignore" ? resolved.diagnostics.orderIdPresent : true,
    ).toBe(false);
  });

  it("accepts short PAYMENT_SUCCESS type label", () => {
    const event = normalizeCashfreePaymentWebhook({
      payload: {
        type: "PAYMENT_SUCCESS",
        data: {
          order: { order_id: "DOOT-SHORT" },
          payment: { payment_status: "SUCCESS" },
        },
      },
    });
    expect(event?.eventType).toBe("PAYMENT_SUCCESS");
  });
});
