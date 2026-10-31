import { z } from "zod";
import {
  DEFAULT_FINANCE_LIST_LIMIT,
  DEFAULT_FINANCE_LIST_PAGE,
  DEFAULT_RECONCILIATION_ISSUES,
  FINANCE_BUSINESS_TIMEZONE,
  MAX_FINANCE_LIST_LIMIT,
  MAX_FINANCE_RANGE_DAYS,
  MAX_RECONCILIATION_ISSUES,
} from "./admin-finance.constants.js";

const MS_PER_DAY = 86_400_000;

const paymentStatuses = [
  "CREATED",
  "PENDING",
  "PAID",
  "FAILED",
  "EXPIRED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
] as const;

const refundStatuses = [
  "REQUESTED",
  "PENDING",
  "SUCCESS",
  "FAILED",
  "CANCELLED",
] as const;

const gatewayCodes = ["STUB", "CASHFREE"] as const;

export const financeRangeQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((data, ctx) => {
    const from = new Date(data.from);
    const toExclusive = new Date(data.to);
    if (from.getTime() >= toExclusive.getTime()) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: "to must be after from (half-open interval: from <= eventTime < to).",
      });
      return;
    }
    const rangeMs = toExclusive.getTime() - from.getTime();
    if (rangeMs > MAX_FINANCE_RANGE_DAYS * MS_PER_DAY) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: `Finance range must not exceed ${MAX_FINANCE_RANGE_DAYS} days.`,
      });
    }
  });

export type FinanceRangeQuery = z.infer<typeof financeRangeQuerySchema>;

export const listPaymentsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(DEFAULT_FINANCE_LIST_PAGE),
    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(MAX_FINANCE_LIST_LIMIT)
      .default(DEFAULT_FINANCE_LIST_LIMIT),
    status: z.enum(paymentStatuses).optional(),
    gateway: z.enum(gatewayCodes).optional(),
    deliveryReference: z.string().trim().min(1).max(64).optional(),
    paidFrom: z.string().datetime({ offset: true }).optional(),
    paidTo: z.string().datetime({ offset: true }).optional(),
    search: z.string().trim().min(1).max(128).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.paidFrom && data.paidTo) {
      const from = new Date(data.paidFrom);
      const to = new Date(data.paidTo);
      if (from.getTime() >= to.getTime()) {
        ctx.addIssue({
          code: "custom",
          path: ["paidTo"],
          message: "paidTo must be after paidFrom (half-open on paidAt).",
        });
      }
    }
  });

export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;

export const listRefundsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(DEFAULT_FINANCE_LIST_PAGE),
    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(MAX_FINANCE_LIST_LIMIT)
      .default(DEFAULT_FINANCE_LIST_LIMIT),
    status: z.enum(refundStatuses).optional(),
    deliveryReference: z.string().trim().min(1).max(64).optional(),
    processedFrom: z.string().datetime({ offset: true }).optional(),
    processedTo: z.string().datetime({ offset: true }).optional(),
    requestedFrom: z.string().datetime({ offset: true }).optional(),
    requestedTo: z.string().datetime({ offset: true }).optional(),
    activityFrom: z.string().datetime({ offset: true }).optional(),
    activityTo: z.string().datetime({ offset: true }).optional(),
  })
  .superRefine((data, ctx) => {
    const hasLegacyPeriod =
      data.processedFrom != null ||
      data.processedTo != null ||
      data.requestedFrom != null ||
      data.requestedTo != null;
    const hasActivity = data.activityFrom != null || data.activityTo != null;
    if (hasActivity && hasLegacyPeriod) {
      ctx.addIssue({
        code: "custom",
        path: ["activityFrom"],
        message:
          "Use either activityFrom/activityTo or processed/requested range filters, not both.",
      });
    }
    if (hasActivity && (!data.activityFrom || !data.activityTo)) {
      ctx.addIssue({
        code: "custom",
        path: ["activityTo"],
        message: "activityFrom and activityTo must both be provided.",
      });
    }
    if (data.activityFrom && data.activityTo) {
      const from = new Date(data.activityFrom);
      const to = new Date(data.activityTo);
      if (from.getTime() >= to.getTime()) {
        ctx.addIssue({
          code: "custom",
          path: ["activityTo"],
          message:
            "activityTo must be after activityFrom (half-open: requestedAt or processedAt in range).",
        });
      }
    }
    if (data.processedFrom && data.processedTo) {
      const from = new Date(data.processedFrom);
      const to = new Date(data.processedTo);
      if (from.getTime() >= to.getTime()) {
        ctx.addIssue({
          code: "custom",
          path: ["processedTo"],
          message: "processedTo must be after processedFrom.",
        });
      }
    }
    if (data.requestedFrom && data.requestedTo) {
      const from = new Date(data.requestedFrom);
      const to = new Date(data.requestedTo);
      if (from.getTime() >= to.getTime()) {
        ctx.addIssue({
          code: "custom",
          path: ["requestedTo"],
          message: "requestedTo must be after requestedFrom.",
        });
      }
    }
  });

export type ListRefundsQuery = z.infer<typeof listRefundsQuerySchema>;

export const paymentIdParamsSchema = z.object({
  id: z.string().uuid("Invalid payment id"),
});

export type PaymentIdParams = z.infer<typeof paymentIdParamsSchema>;

export const financeTimeseriesQuerySchema = financeRangeQuerySchema.and(
  z.object({
    granularity: z.enum(["day", "week", "month"]).default("day"),
  }),
);

export type FinanceTimeseriesQuery = z.infer<typeof financeTimeseriesQuerySchema>;

export const financeReconciliationQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(MAX_RECONCILIATION_ISSUES)
      .default(DEFAULT_RECONCILIATION_ISSUES),
  })
  .superRefine((data, ctx) => {
    if (data.from && data.to) {
      const from = new Date(data.from);
      const toExclusive = new Date(data.to);
      if (from.getTime() >= toExclusive.getTime()) {
        ctx.addIssue({
          code: "custom",
          path: ["to"],
          message: "to must be after from.",
        });
      }
    }
    if ((data.from && !data.to) || (!data.from && data.to)) {
      ctx.addIssue({
        code: "custom",
        path: ["from"],
        message:
          "from and to must both be provided for a scoped reconciliation window.",
      });
    }
  });

export type FinanceReconciliationQuery = z.infer<
  typeof financeReconciliationQuerySchema
>;

export type FinanceWindow = {
  from: Date;
  toExclusive: Date;
};

export function parseFinanceRange(query: FinanceRangeQuery): FinanceWindow {
  return {
    from: new Date(query.from),
    toExclusive: new Date(query.to),
  };
}

export function toFinanceWindowDto(window: FinanceWindow): {
  from: string;
  toExclusive: string;
  timeZone: typeof FINANCE_BUSINESS_TIMEZONE;
} {
  return {
    from: window.from.toISOString(),
    toExclusive: window.toExclusive.toISOString(),
    timeZone: FINANCE_BUSINESS_TIMEZONE,
  };
}
