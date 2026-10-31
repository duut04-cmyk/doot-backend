import type { PaymentStatus, Prisma } from "@prisma/client";
import type { FinanceWindow } from "./admin-finance.schema.js";

/** Statuses for gross customer collections (original Payment.amount at paidAt). */
export const PERIOD_GROSS_COLLECTION_STATUSES = [
  "PAID",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
] as const satisfies readonly PaymentStatus[];

export function periodGrossCollectionWhere(
  window: FinanceWindow,
): Prisma.PaymentWhereInput {
  return {
    status: { in: [...PERIOD_GROSS_COLLECTION_STATUSES] },
    paidAt: { gte: window.from, lt: window.toExclusive },
  };
}

export function periodSuccessfulRefundWhere(
  window: FinanceWindow,
): Prisma.RefundWhereInput {
  return {
    status: "SUCCESS",
    processedAt: { gte: window.from, lt: window.toExclusive },
  };
}

export function periodPendingRefundWhere(
  window: FinanceWindow,
): Prisma.RefundWhereInput {
  return {
    status: { in: ["REQUESTED", "PENDING"] },
    requestedAt: { gte: window.from, lt: window.toExclusive },
  };
}

export function periodFailedRefundWhere(
  window: FinanceWindow,
): Prisma.RefundWhereInput {
  return {
    status: "FAILED",
    processedAt: { gte: window.from, lt: window.toExclusive },
  };
}
