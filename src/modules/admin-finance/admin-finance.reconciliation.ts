import { Prisma } from "@prisma/client";
import {
  ledgerIdempotencyKeyForPaymentSuccess,
  ledgerIdempotencyKeyForRefund,
} from "../payment/payment.constants.js";
import { decimalToMoneyString, moneyStringsEqual } from "./admin-finance.money.js";
import type {
  AdminFinanceReconciliationDto,
  ReconciliationIssueDto,
} from "./admin-finance.types.js";
import type { FinanceWindow } from "./admin-finance.schema.js";
import { toFinanceWindowDto } from "./admin-finance.schema.js";

export type ReconciliationPaymentRow = {
  id: string;
  deliveryId: string;
  status: string;
  amount: Prisma.Decimal;
  refundedAmount: Prisma.Decimal;
  paidAt: Date | null;
};

export type ReconciliationRefundRow = {
  id: string;
  paymentId: string;
  deliveryId: string;
  amount: Prisma.Decimal;
  status: string;
  processedAt: Date | null;
};

export type ReconciliationLedgerRow = {
  id: string;
  paymentId: string;
  refundId: string | null;
  deliveryId: string;
  type: string;
  direction: string;
  amount: Prisma.Decimal;
  idempotencyKey: string;
};

export function runInternalReconciliation(input: {
  window: FinanceWindow | null;
  payments: ReconciliationPaymentRow[];
  refunds: ReconciliationRefundRow[];
  ledgerEntries: ReconciliationLedgerRow[];
  issueLimit: number;
}): AdminFinanceReconciliationDto {
  const issues: ReconciliationIssueDto[] = [];
  const push = (issue: ReconciliationIssueDto) => {
    if (issues.length < input.issueLimit) {
      issues.push(issue);
    }
  };

  const ledgerByPayment = new Map<string, ReconciliationLedgerRow[]>();
  const ledgerByRefund = new Map<string, ReconciliationLedgerRow[]>();
  for (const entry of input.ledgerEntries) {
    const list = ledgerByPayment.get(entry.paymentId) ?? [];
    list.push(entry);
    ledgerByPayment.set(entry.paymentId, list);
    if (entry.refundId) {
      const rlist = ledgerByRefund.get(entry.refundId) ?? [];
      rlist.push(entry);
      ledgerByRefund.set(entry.refundId, rlist);
    }
  }

  const refundsByPayment = new Map<string, ReconciliationRefundRow[]>();
  for (const refund of input.refunds) {
    const list = refundsByPayment.get(refund.paymentId) ?? [];
    list.push(refund);
    refundsByPayment.set(refund.paymentId, list);
  }

  for (const payment of input.payments) {
    const amountStr = decimalToMoneyString(payment.amount);
    const paymentLedgers = ledgerByPayment.get(payment.id) ?? [];
    const captureEntries = paymentLedgers.filter(
      (row) => row.type === "CUSTOMER_PAYMENT" && row.direction === "CREDIT",
    );

    if (
      payment.status === "PAID" ||
      payment.status.startsWith("PARTIALLY") ||
      payment.status === "REFUNDED"
    ) {
      if (captureEntries.length === 0) {
        push({
          severity: "error",
          type: "MISSING_CUSTOMER_PAYMENT_LEDGER",
          paymentId: payment.id,
          refundId: null,
          ledgerEntryId: null,
          deliveryId: payment.deliveryId,
          expectedAmount: amountStr,
          actualAmount: "0.00",
          explanation:
            "PAID or post-refund payment has no CUSTOMER_PAYMENT CREDIT ledger entry.",
        });
      } else if (captureEntries.length > 1) {
        push({
          severity: "error",
          type: "DUPLICATE_CUSTOMER_PAYMENT_LEDGER",
          paymentId: payment.id,
          refundId: null,
          ledgerEntryId: captureEntries[1]!.id,
          deliveryId: payment.deliveryId,
          expectedAmount: "1",
          actualAmount: String(captureEntries.length),
          explanation: "Multiple CUSTOMER_PAYMENT CREDIT ledger rows for one payment.",
        });
      } else {
        const entry = captureEntries[0]!;
        const entryAmount = decimalToMoneyString(entry.amount);
        if (!moneyStringsEqual(entryAmount, amountStr)) {
          push({
            severity: "error",
            type: "CUSTOMER_PAYMENT_AMOUNT_MISMATCH",
            paymentId: payment.id,
            refundId: null,
            ledgerEntryId: entry.id,
            deliveryId: payment.deliveryId,
            expectedAmount: amountStr,
            actualAmount: entryAmount,
            explanation:
              "CUSTOMER_PAYMENT ledger amount does not match Payment.amount.",
          });
        }
        const expectedKey = ledgerIdempotencyKeyForPaymentSuccess(payment.id);
        if (entry.idempotencyKey !== expectedKey) {
          push({
            severity: "warning",
            type: "CUSTOMER_PAYMENT_IDEMPOTENCY_KEY_UNEXPECTED",
            paymentId: payment.id,
            refundId: null,
            ledgerEntryId: entry.id,
            deliveryId: payment.deliveryId,
            expectedAmount: null,
            actualAmount: null,
            explanation: `Expected idempotency key ${expectedKey}, found ${entry.idempotencyKey}.`,
          });
        }
      }
    }

    const successRefunds = (refundsByPayment.get(payment.id) ?? []).filter(
      (row) => row.status === "SUCCESS",
    );
    const successSum = successRefunds.reduce(
      (acc, row) => acc.add(row.amount),
      new Prisma.Decimal(0),
    );
    const successSumStr = decimalToMoneyString(successSum);
    const refundedAmountStr = decimalToMoneyString(payment.refundedAmount);
    if (!moneyStringsEqual(successSumStr, refundedAmountStr)) {
      push({
        severity: "warning",
        type: "PAYMENT_REFUNDED_AMOUNT_MISMATCH",
        paymentId: payment.id,
        refundId: null,
        ledgerEntryId: null,
        deliveryId: payment.deliveryId,
        expectedAmount: successSumStr,
        actualAmount: refundedAmountStr,
        explanation:
          "Payment.refundedAmount does not match sum of SUCCESS Refund records.",
      });
    }

    for (const refund of successRefunds) {
      const refundAmountStr = decimalToMoneyString(refund.amount);
      const debitEntries = (ledgerByRefund.get(refund.id) ?? []).filter(
        (row) => row.type === "REFUND" && row.direction === "DEBIT",
      );
      if (debitEntries.length === 0) {
        push({
          severity: "error",
          type: "MISSING_REFUND_LEDGER",
          paymentId: payment.id,
          refundId: refund.id,
          ledgerEntryId: null,
          deliveryId: refund.deliveryId,
          expectedAmount: refundAmountStr,
          actualAmount: "0.00",
          explanation: "SUCCESS refund has no REFUND DEBIT ledger entry.",
        });
      } else if (debitEntries.length > 1) {
        push({
          severity: "error",
          type: "DUPLICATE_REFUND_LEDGER",
          paymentId: payment.id,
          refundId: refund.id,
          ledgerEntryId: debitEntries[1]!.id,
          deliveryId: refund.deliveryId,
          expectedAmount: "1",
          actualAmount: String(debitEntries.length),
          explanation: "Multiple REFUND DEBIT ledger rows for one refund.",
        });
      } else {
        const entry = debitEntries[0]!;
        const entryAmount = decimalToMoneyString(entry.amount);
        if (!moneyStringsEqual(entryAmount, refundAmountStr)) {
          push({
            severity: "error",
            type: "REFUND_LEDGER_AMOUNT_MISMATCH",
            paymentId: payment.id,
            refundId: refund.id,
            ledgerEntryId: entry.id,
            deliveryId: refund.deliveryId,
            expectedAmount: refundAmountStr,
            actualAmount: entryAmount,
            explanation: "REFUND ledger amount does not match Refund.amount.",
          });
        }
        const expectedKey = ledgerIdempotencyKeyForRefund(refund.id);
        if (entry.idempotencyKey !== expectedKey) {
          push({
            severity: "warning",
            type: "REFUND_IDEMPOTENCY_KEY_UNEXPECTED",
            paymentId: payment.id,
            refundId: refund.id,
            ledgerEntryId: entry.id,
            deliveryId: refund.deliveryId,
            expectedAmount: null,
            actualAmount: null,
            explanation: `Expected idempotency key ${expectedKey}, found ${entry.idempotencyKey}.`,
          });
        }
      }
    }
  }

  const knownLedgerIds = new Set(input.ledgerEntries.map((row) => row.id));
  for (const entry of input.ledgerEntries) {
    const payment = input.payments.find((row) => row.id === entry.paymentId);
    if (!payment) {
      push({
        severity: "error",
        type: "ORPHAN_LEDGER_PAYMENT",
        paymentId: entry.paymentId,
        refundId: entry.refundId,
        ledgerEntryId: entry.id,
        deliveryId: entry.deliveryId,
        expectedAmount: null,
        actualAmount: decimalToMoneyString(entry.amount),
        explanation:
          "Ledger entry references a payment not included in reconciliation scan.",
      });
    }
    if (entry.refundId) {
      const refund = input.refunds.find((row) => row.id === entry.refundId);
      if (!refund) {
        push({
          severity: "error",
          type: "ORPHAN_LEDGER_REFUND",
          paymentId: entry.paymentId,
          refundId: entry.refundId,
          ledgerEntryId: entry.id,
          deliveryId: entry.deliveryId,
          expectedAmount: null,
          actualAmount: decimalToMoneyString(entry.amount),
          explanation:
            "Ledger entry references a refund not included in reconciliation scan.",
        });
      }
    }
  }

  void knownLedgerIds;

  const truncated =
    issues.length >= input.issueLimit &&
    input.payments.length + input.refunds.length + input.ledgerEntries.length > 0;

  return {
    window: input.window ? toFinanceWindowDto(input.window) : null,
    scannedPayments: input.payments.length,
    scannedRefunds: input.refunds.length,
    scannedLedgerEntries: input.ledgerEntries.length,
    issueCount: issues.length,
    truncated,
    issues,
    disclaimer:
      "Internal database reconciliation only; not Cashfree settlement reconciliation.",
  };
}
