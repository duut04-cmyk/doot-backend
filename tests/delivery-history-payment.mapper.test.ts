import { describe, expect, it } from "vitest";
import {
  mapPaymentHistorySection,
  resolvePricingBreakdownFromSnapshot,
} from "../src/modules/delivery/delivery-history-payment.mapper.js";
import type { PaymentDto } from "../src/modules/payment/payment.types.js";

describe("delivery-history-payment.mapper", () => {
  it("resolves full pricing breakdown from enriched quote snapshot", () => {
    const breakdown = resolvePricingBreakdownFromSnapshot({
      amount: 150,
      currency: "INR",
      providerQuoteAmount: 150,
      platformFeePercent: 10,
      platformFeeAmount: 15,
      gstAmount: 29.7,
      customerPayableAmount: 194.7,
    });

    expect(breakdown.providerQuoteAmount).toBe(150);
    expect(breakdown.platformFeeAmount).toBe(15);
    expect(breakdown.gstAmount).toBe(29.7);
    expect(breakdown.customerPayableAmount).toBe(194.7);
  });

  it("maps payment with gateway payment id from successful attempt", () => {
    const payment: PaymentDto = {
      id: "pay-1",
      deliveryId: "del-1",
      customerId: "cust-1",
      amount: 194.7,
      currency: "INR",
      status: "PAID",
      gateway: "CASHFREE",
      gatewayOrderId: "order_abc",
      gatewayPaymentSessionId: "sess_1",
      pricingSource: {
        orchestrationRequestId: "orch-1",
        orchestrationOptionId: "opt-1",
        quoteSnapshot: {
          amount: 150,
          currency: "INR",
          providerQuoteAmount: 150,
          platformFeePercent: 10,
          platformFeeAmount: 15,
          gstAmount: 29.7,
          customerPayableAmount: 194.7,
        },
      },
      paidAt: new Date("2025-10-21T10:00:00.000Z"),
      failedAt: null,
      expiredAt: null,
      refundedAmount: 194.7,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mapped = mapPaymentHistorySection({
      payment,
      attempts: [
        {
          id: "att-1",
          paymentId: "pay-1",
          attemptNumber: 1,
          gatewayPaymentId: "cf_pay_123",
          gatewayOrderId: "order_abc",
          status: "SUCCEEDED",
          amount: 194.7,
          currency: "INR",
          paymentMethod: "UPI",
          failureCode: null,
          failureMessage: null,
          metadata: null,
          startedAt: new Date(),
          completedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      refunds: [],
    });

    expect(mapped?.gatewayPaymentId).toBe("cf_pay_123");
    expect(mapped?.pricingBreakdown.customerPayableAmount).toBe(194.7);
  });
});
