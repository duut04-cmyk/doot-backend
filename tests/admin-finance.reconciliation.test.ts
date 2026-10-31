import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { runInternalReconciliation } from "../src/modules/admin-finance/admin-finance.reconciliation.js";

describe("admin finance reconciliation", () => {
  it("flags missing CUSTOMER_PAYMENT ledger for PAID payment", () => {
    const result = runInternalReconciliation({
      window: null,
      payments: [
        {
          id: "pay-1",
          deliveryId: "del-1",
          status: "PAID",
          amount: new Prisma.Decimal("100.00"),
          refundedAmount: new Prisma.Decimal(0),
          paidAt: new Date(),
        },
      ],
      refunds: [],
      ledgerEntries: [],
      issueLimit: 50,
    });
    expect(
      result.issues.some((i) => i.type === "MISSING_CUSTOMER_PAYMENT_LEDGER"),
    ).toBe(true);
  });

  it("flags refundedAmount mismatch against SUCCESS refunds", () => {
    const result = runInternalReconciliation({
      window: null,
      payments: [
        {
          id: "pay-1",
          deliveryId: "del-1",
          status: "PARTIALLY_REFUNDED",
          amount: new Prisma.Decimal("100.00"),
          refundedAmount: new Prisma.Decimal("10.00"),
          paidAt: new Date(),
        },
      ],
      refunds: [
        {
          id: "ref-1",
          paymentId: "pay-1",
          deliveryId: "del-1",
          amount: new Prisma.Decimal("25.00"),
          status: "SUCCESS",
          processedAt: new Date(),
        },
      ],
      ledgerEntries: [
        {
          id: "led-1",
          paymentId: "pay-1",
          refundId: null,
          deliveryId: "del-1",
          type: "CUSTOMER_PAYMENT",
          direction: "CREDIT",
          amount: new Prisma.Decimal("100.00"),
          idempotencyKey: "payment-paid:pay-1",
        },
        {
          id: "led-2",
          paymentId: "pay-1",
          refundId: "ref-1",
          deliveryId: "del-1",
          type: "REFUND",
          direction: "DEBIT",
          amount: new Prisma.Decimal("25.00"),
          idempotencyKey: "refund:ref-1",
        },
      ],
      issueLimit: 50,
    });
    expect(
      result.issues.some((i) => i.type === "PAYMENT_REFUNDED_AMOUNT_MISMATCH"),
    ).toBe(true);
  });

  it("does not treat FAILED refund processedAt as successful refund ledger requirement", () => {
    const result = runInternalReconciliation({
      window: null,
      payments: [
        {
          id: "pay-1",
          deliveryId: "del-1",
          status: "PAID",
          amount: new Prisma.Decimal("50.00"),
          refundedAmount: new Prisma.Decimal(0),
          paidAt: new Date(),
        },
      ],
      refunds: [
        {
          id: "ref-failed",
          paymentId: "pay-1",
          deliveryId: "del-1",
          amount: new Prisma.Decimal("50.00"),
          status: "FAILED",
          processedAt: new Date(),
        },
      ],
      ledgerEntries: [
        {
          id: "led-1",
          paymentId: "pay-1",
          refundId: null,
          deliveryId: "del-1",
          type: "CUSTOMER_PAYMENT",
          direction: "CREDIT",
          amount: new Prisma.Decimal("50.00"),
          idempotencyKey: "payment-paid:pay-1",
        },
      ],
      issueLimit: 50,
    });
    expect(result.issues.some((i) => i.type === "MISSING_REFUND_LEDGER")).toBe(false);
  });
});
