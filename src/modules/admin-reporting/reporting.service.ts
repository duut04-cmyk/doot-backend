import {
  aggregateFailureReasons,
  buildServiceScorecard,
  computeBookingSuccessRate,
  computeFunnelCounts,
  computeOrchestrationRunStats,
  computePackageTypeDistribution,
  computeTrend,
  computeTrendNullable,
  countDeliveriesByStatus,
} from "./reporting.metrics.js";
import { previousReportingWindow } from "./reporting.schema.js";
import {
  reportingRepository,
  type ReportingRepository,
  type ReportingWindow,
} from "./reporting.repository.js";
import type {
  FeedbackReportingDto,
  OrchestrationReportingDto,
  RecentActivityReportingDto,
  RecentDeliveriesReportingDto,
  ReportingSummaryDto,
} from "./reporting.types.js";

const FUNNEL_ATTEMPT_RULE =
  "Latest completed orchestration attempt per delivery (completedAt desc, attemptNumber desc, id desc).";

function truncateRouteLabel(value: string, max = 48): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export class ReportingService {
  constructor(private readonly repository: ReportingRepository = reportingRepository) {}

  async getSummary(
    window: ReportingWindow,
  ): Promise<{ success: true; data: ReportingSummaryDto }> {
    const previous = previousReportingWindow(window.from, window.toExclusive);
    const [cohort, runs, previousCohort, previousRuns] = await Promise.all([
      this.repository.loadDeliveryCohort(window),
      this.repository.loadOrchestrationRuns(window),
      this.repository.loadDeliveryCohort(previous),
      this.repository.loadOrchestrationRuns(previous),
    ]);

    const deliveryIds = cohort.map((row) => row.id);
    const [bookings, funnelRuns] = await Promise.all([
      this.repository.loadBookingsForDeliveries(deliveryIds),
      this.repository.loadOrchestrationRunsForDeliveries(deliveryIds),
    ]);
    const funnelRequestIds = funnelRuns.map((run) => run.id);
    const evaluations =
      await this.repository.loadEvaluationsForRequests(funnelRequestIds);

    const statusCounts = countDeliveriesByStatus(cohort);
    const booking = computeBookingSuccessRate(deliveryIds, bookings);
    const orchestrationRuns = computeOrchestrationRunStats(runs);
    const funnel = computeFunnelCounts({
      cohort,
      runs: funnelRuns,
      evaluations,
      bookings,
    });

    const prevStatus = countDeliveriesByStatus(previousCohort);
    const prevBooking = computeBookingSuccessRate(
      previousCohort.map((row) => row.id),
      await this.repository.loadBookingsForDeliveries(
        previousCohort.map((row) => row.id),
      ),
    );
    const prevOrchestration = computeOrchestrationRunStats(previousRuns);

    return {
      success: true,
      data: {
        window: {
          from: window.from.toISOString(),
          toExclusive: window.toExclusive.toISOString(),
          timeZone: "Asia/Kolkata",
        },
        deliveriesCreated: {
          total: statusCounts.total,
          deliveredCurrentStatus: statusCounts.delivered,
          deliveredLabel: "Deliveries created in period that are currently delivered",
          inProgress: statusCounts.inProgress,
          cancelled: statusCounts.cancelled,
          failed: statusCounts.failed,
        },
        booking: {
          deliveriesWithBookingAttempt: booking.deliveriesWithBookingAttempt,
          deliveriesWithConfirmedBooking: booking.deliveriesWithConfirmedBooking,
          successRatePercent: booking.successRatePercent,
          successRateLabel:
            "BOOKED deliveries / deliveries with at least one provider booking record (UNKNOWN not counted as success)",
        },
        orchestrationRuns,
        funnel: {
          ...funnel,
          attemptSelectionRule: FUNNEL_ATTEMPT_RULE,
        },
        packageTypeDistribution: computePackageTypeDistribution(cohort),
        trends: {
          deliveriesCreated: computeTrend(statusCounts.total, prevStatus.total),
          deliveredCurrentStatus: computeTrend(
            statusCounts.delivered,
            prevStatus.delivered,
          ),
          bookingSuccessRatePercent: computeTrendNullable(
            booking.successRatePercent,
            prevBooking.successRatePercent,
          ),
          orchestrationFailureRatePercent: computeTrendNullable(
            orchestrationRuns.failureRatePercent,
            prevOrchestration.failureRatePercent,
          ),
          averageOrchestrationDurationMs: computeTrendNullable(
            orchestrationRuns.averageDurationMs,
            prevOrchestration.averageDurationMs,
          ),
        },
      },
    };
  }

  async getOrchestrationReporting(
    window: ReportingWindow,
  ): Promise<{ success: true; data: OrchestrationReportingDto }> {
    const [runs, evaluations] = await Promise.all([
      this.repository.loadOrchestrationRuns(window),
      this.repository.loadEvaluationsInRunWindow(window),
    ]);
    const deliveryIds = [...new Set(evaluations.map((row) => row.deliveryId))];
    const bookings = await this.repository.loadBookingsForDeliveriesInWindow(
      window,
      deliveryIds,
    );

    const runsByStatus: Record<string, number> = {};
    for (const run of runs) {
      runsByStatus[run.status] = (runsByStatus[run.status] ?? 0) + 1;
    }

    return {
      success: true,
      data: {
        window: {
          from: window.from.toISOString(),
          toExclusive: window.toExclusive.toISOString(),
        },
        runsByStatus,
        failureReasons: aggregateFailureReasons(runs),
        serviceScorecard: buildServiceScorecard({ evaluations, bookings }).map(
          (row) => ({
            ...row,
            providerQuoteLabel: "Provider quote amount (INR), not customer revenue",
            bookingSuccessRateLabel:
              "BOOKED provider booking attempts / all provider booking attempts in window (UNKNOWN and FAILED are not success)",
          }),
        ),
      },
    };
  }

  async getRecentDeliveries(
    window: ReportingWindow,
    limit: number,
  ): Promise<{ success: true; data: RecentDeliveriesReportingDto }> {
    const rows = await this.repository.loadRecentDeliveries(window, limit);
    return {
      success: true,
      data: {
        items: rows.map((row) => ({
          deliveryId: row.id,
          reference: row.reference,
          status: row.status,
          packageType: row.packageType,
          createdAt: row.createdAt.toISOString(),
          routeLabel:
            row.pickupLabel && row.dropLabel
              ? `${truncateRouteLabel(row.pickupLabel)} → ${truncateRouteLabel(row.dropLabel)}`
              : null,
        })),
      },
    };
  }

  async getRecentActivity(
    hours: number,
    limit: number,
  ): Promise<{ success: true; data: RecentActivityReportingDto }> {
    const events = await this.repository.loadRecentActivity(hours, limit);
    return {
      success: true,
      data: {
        hours,
        items: events.map((event) => ({
          eventId: event.id,
          deliveryId: event.deliveryId,
          deliveryReference: event.delivery.reference,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          occurredAt: event.createdAt.toISOString(),
          summary: `${event.fromStatus ?? "NEW"} → ${event.toStatus}`,
        })),
      },
    };
  }

  async getFeedbackReporting(
    window: ReportingWindow,
    recentLimit: number,
  ): Promise<{ success: true; data: FeedbackReportingDto }> {
    const { ratings, feedbackRows } =
      await this.repository.loadFeedbackAggregates(window);
    const feedbackCount = feedbackRows.length;
    const averageDriverRating =
      ratings.length === 0
        ? null
        : Math.round(
            (ratings.reduce((sum, row) => sum + row.driverRating, 0) / ratings.length) *
              10,
          ) / 10;
    const averageDeliveryRating =
      ratings.length === 0
        ? null
        : Math.round(
            (ratings.reduce((sum, row) => sum + row.deliveryRating, 0) /
              ratings.length) *
              10,
          ) / 10;

    const issueCounts = new Map<string, number>();
    const positiveCounts = new Map<string, number>();
    for (const row of feedbackRows) {
      for (const tag of row.issueTags) {
        issueCounts.set(tag, (issueCounts.get(tag) ?? 0) + 1);
      }
      for (const tag of row.positiveTags) {
        positiveCounts.set(tag, (positiveCounts.get(tag) ?? 0) + 1);
      }
    }

    const ratingByDelivery = new Map(ratings.map((row) => [row.deliveryId, row]));

    const recentSnippets = feedbackRows.slice(0, recentLimit).map((row) => {
      const rating = ratingByDelivery.get(row.deliveryId);
      return {
        deliveryId: row.deliveryId,
        deliveryReference: row.delivery.reference,
        submittedAt: row.createdAt.toISOString(),
        driverRating: rating?.driverRating ?? 0,
        deliveryRating: rating?.deliveryRating ?? 0,
        issueTagCount: row.issueTags.length,
        positiveTagCount: row.positiveTags.length,
      };
    });

    return {
      success: true,
      data: {
        window: {
          from: window.from.toISOString(),
          toExclusive: window.toExclusive.toISOString(),
        },
        feedbackCount,
        averageDriverRating,
        averageDeliveryRating,
        topIssueTags: [...issueCounts.entries()]
          .map(([tag, count]) => ({ tag, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10),
        topPositiveTags: [...positiveCounts.entries()]
          .map(([tag, count]) => ({ tag, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10),
        recentSnippets,
      },
    };
  }
}

export const reportingService = new ReportingService();
