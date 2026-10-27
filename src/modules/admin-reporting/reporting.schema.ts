import { z } from "zod";
import { MAX_REPORTING_RANGE_DAYS } from "./reporting.constants.js";
import {
  DEFAULT_FEEDBACK_RECENT_LIMIT,
  DEFAULT_RECENT_ACTIVITY_HOURS,
  DEFAULT_RECENT_ACTIVITY_LIMIT,
  DEFAULT_RECENT_DELIVERIES_LIMIT,
  MAX_FEEDBACK_RECENT_LIMIT,
  MAX_RECENT_ACTIVITY_HOURS,
  MAX_RECENT_ACTIVITY_LIMIT,
  MAX_RECENT_DELIVERIES_LIMIT,
} from "./reporting.constants.js";

const MS_PER_DAY = 86_400_000;

export const reportingRangeQuerySchema = z
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
        message: "to must be after from (half-open interval: from <= createdAt < to).",
      });
      return;
    }
    const rangeMs = toExclusive.getTime() - from.getTime();
    if (rangeMs > MAX_REPORTING_RANGE_DAYS * MS_PER_DAY) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: `Reporting range must not exceed ${MAX_REPORTING_RANGE_DAYS} days.`,
      });
    }
  });

export type ReportingRangeQuery = z.infer<typeof reportingRangeQuerySchema>;

export const recentDeliveriesQuerySchema = reportingRangeQuerySchema.and(
  z.object({
    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(MAX_RECENT_DELIVERIES_LIMIT)
      .default(DEFAULT_RECENT_DELIVERIES_LIMIT),
  }),
);

export type RecentDeliveriesQuery = z.infer<typeof recentDeliveriesQuerySchema>;

export const recentActivityQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_RECENT_ACTIVITY_LIMIT)
    .default(DEFAULT_RECENT_ACTIVITY_LIMIT),
  hours: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_RECENT_ACTIVITY_HOURS)
    .default(DEFAULT_RECENT_ACTIVITY_HOURS),
});

export type RecentActivityQuery = z.infer<typeof recentActivityQuerySchema>;

export const feedbackReportingQuerySchema = reportingRangeQuerySchema.and(
  z.object({
    recentLimit: z.coerce
      .number()
      .int()
      .nonnegative()
      .max(MAX_FEEDBACK_RECENT_LIMIT)
      .default(DEFAULT_FEEDBACK_RECENT_LIMIT),
  }),
);

export type FeedbackReportingQuery = z.infer<typeof feedbackReportingQuerySchema>;

export function parseReportingRange(query: ReportingRangeQuery): {
  from: Date;
  toExclusive: Date;
} {
  return {
    from: new Date(query.from),
    toExclusive: new Date(query.to),
  };
}

export function previousReportingWindow(
  from: Date,
  toExclusive: Date,
): {
  from: Date;
  toExclusive: Date;
} {
  const durationMs = toExclusive.getTime() - from.getTime();
  return {
    from: new Date(from.getTime() - durationMs),
    toExclusive: from,
  };
}
