import type { Prisma, RefundStatus } from "@prisma/client";
import type { FinanceWindow } from "./admin-finance.schema.js";

export function periodRefundActivityWhere(
  window: FinanceWindow,
): Prisma.RefundWhereInput {
  return {
    OR: [
      {
        requestedAt: {
          gte: window.from,
          lt: window.toExclusive,
        },
      },
      {
        processedAt: {
          gte: window.from,
          lt: window.toExclusive,
        },
      },
    ],
  };
}

export function mergeRefundListWhere(input: {
  status?: RefundStatus;
  deliveryReference?: string;
  processedFrom?: Date;
  processedToExclusive?: Date;
  requestedFrom?: Date;
  requestedToExclusive?: Date;
  activityFrom?: Date;
  activityToExclusive?: Date;
}): Prisma.RefundWhereInput {
  const and: Prisma.RefundWhereInput[] = [];

  if (input.activityFrom != null && input.activityToExclusive != null) {
    and.push({
      OR: [
        {
          requestedAt: {
            gte: input.activityFrom,
            lt: input.activityToExclusive,
          },
        },
        {
          processedAt: {
            gte: input.activityFrom,
            lt: input.activityToExclusive,
          },
        },
      ],
    });
  } else {
    if (input.processedFrom != null || input.processedToExclusive != null) {
      and.push({
        processedAt: {
          ...(input.processedFrom ? { gte: input.processedFrom } : {}),
          ...(input.processedToExclusive ? { lt: input.processedToExclusive } : {}),
        },
      });
    }
    if (input.requestedFrom != null || input.requestedToExclusive != null) {
      and.push({
        requestedAt: {
          ...(input.requestedFrom ? { gte: input.requestedFrom } : {}),
          ...(input.requestedToExclusive ? { lt: input.requestedToExclusive } : {}),
        },
      });
    }
  }

  if (input.status) {
    and.push({ status: input.status });
  }
  if (input.deliveryReference) {
    and.push({
      payment: { delivery: { reference: input.deliveryReference } },
    });
  }

  if (and.length === 0) {
    return {};
  }
  if (and.length === 1) {
    return and[0]!;
  }
  return { AND: and };
}
