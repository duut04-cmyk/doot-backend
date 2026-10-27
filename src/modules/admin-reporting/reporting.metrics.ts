import type { OrchestrationRequestStatus, ProviderBookingStatus } from "@prisma/client";
import {
  DELIVERED_DELIVERY_STATUS,
  IN_PROGRESS_DELIVERY_STATUSES,
} from "./reporting.constants.js";
import type { ReportingTrendValue } from "./reporting.types.js";

export type DeliveryCohortRow = {
  id: string;
  status: import("@prisma/client").DeliveryStatus;
  packageType: import("@prisma/client").PackageType | null;
};

export type OrchestrationRunRow = {
  id: string;
  deliveryId: string;
  status: OrchestrationRequestStatus;
  failureReason: string | null;
  startedAt: Date;
  completedAt: Date | null;
  attemptNumber: number;
};

export type EvaluationRow = {
  orchestrationRequestId: string;
  deliveryId: string;
  status: import("@prisma/client").OrchestrationEvaluationStatus;
  quoteAmount: number | null;
  providerServiceCode: string | null;
  selected: boolean;
};

export type BookingRow = {
  deliveryId: string;
  status: ProviderBookingStatus;
  providerServiceCode: string | null;
};

export function countDeliveriesByStatus(cohort: DeliveryCohortRow[]) {
  let delivered = 0;
  let inProgress = 0;
  let cancelled = 0;
  let failed = 0;
  for (const row of cohort) {
    if (row.status === DELIVERED_DELIVERY_STATUS) delivered += 1;
    else if (IN_PROGRESS_DELIVERY_STATUSES.includes(row.status)) inProgress += 1;
    else if (row.status === "CANCELLED") cancelled += 1;
    else if (row.status === "FAILED") failed += 1;
  }
  return { delivered, inProgress, cancelled, failed, total: cohort.length };
}

export function computeBookingSuccessRate(
  cohortDeliveryIds: string[],
  bookings: BookingRow[],
): {
  deliveriesWithBookingAttempt: number;
  deliveriesWithConfirmedBooking: number;
  successRatePercent: number | null;
} {
  const cohort = new Set(cohortDeliveryIds);
  const attemptsByDelivery = new Map<string, ProviderBookingStatus[]>();
  for (const booking of bookings) {
    if (!cohort.has(booking.deliveryId)) continue;
    const list = attemptsByDelivery.get(booking.deliveryId) ?? [];
    list.push(booking.status);
    attemptsByDelivery.set(booking.deliveryId, list);
  }
  const deliveriesWithBookingAttempt = attemptsByDelivery.size;
  let deliveriesWithConfirmedBooking = 0;
  for (const statuses of attemptsByDelivery.values()) {
    if (statuses.includes("BOOKED")) {
      deliveriesWithConfirmedBooking += 1;
    }
  }
  const successRatePercent =
    deliveriesWithBookingAttempt === 0
      ? null
      : Math.round(
          (deliveriesWithConfirmedBooking / deliveriesWithBookingAttempt) * 1000,
        ) / 10;
  return {
    deliveriesWithBookingAttempt,
    deliveriesWithConfirmedBooking,
    successRatePercent,
  };
}

export function computeOrchestrationRunStats(runs: OrchestrationRunRow[]) {
  let completedRuns = 0;
  let failedRuns = 0;
  const durations: number[] = [];
  for (const run of runs) {
    if (run.status === "COMPLETED") {
      completedRuns += 1;
      if (run.completedAt) {
        durations.push(run.completedAt.getTime() - run.startedAt.getTime());
      }
    } else if (run.status === "FAILED") {
      failedRuns += 1;
    }
  }
  const totalRuns = runs.length;
  const failureRatePercent =
    totalRuns === 0 ? null : Math.round((failedRuns / totalRuns) * 1000) / 10;
  const averageDurationMs =
    durations.length === 0
      ? null
      : Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
  return {
    totalRuns,
    completedRuns,
    failedRuns,
    failureRatePercent,
    averageDurationMs,
    durationSampleSize: durations.length,
  };
}

/**
 * For funnel stages requiring orchestration outcomes, use the latest completed
 * attempt per delivery ordered by completedAt desc, then attemptNumber desc, then id.
 */
export function pickLatestCompletedRunPerDelivery(
  runs: OrchestrationRunRow[],
): Map<string, OrchestrationRunRow> {
  const completed = runs.filter((run) => run.status === "COMPLETED" && run.completedAt);
  completed.sort((a, b) => {
    const aComplete = a.completedAt!.getTime();
    const bComplete = b.completedAt!.getTime();
    if (bComplete !== aComplete) return bComplete - aComplete;
    if (b.attemptNumber !== a.attemptNumber) return b.attemptNumber - a.attemptNumber;
    return b.id.localeCompare(a.id);
  });
  const map = new Map<string, OrchestrationRunRow>();
  for (const run of completed) {
    if (!map.has(run.deliveryId)) {
      map.set(run.deliveryId, run);
    }
  }
  return map;
}

export function computeFunnelCounts(input: {
  cohort: DeliveryCohortRow[];
  runs: OrchestrationRunRow[];
  evaluations: EvaluationRow[];
  bookings: BookingRow[];
}) {
  const deliveriesCreated = input.cohort.length;
  const latestRunByDelivery = pickLatestCompletedRunPerDelivery(input.runs);
  const evaluationsByRequest = new Map<string, EvaluationRow[]>();
  for (const evaluation of input.evaluations) {
    const list = evaluationsByRequest.get(evaluation.orchestrationRequestId) ?? [];
    list.push(evaluation);
    evaluationsByRequest.set(evaluation.orchestrationRequestId, list);
  }

  let withEligibleEvaluation = 0;
  let withQuote = 0;
  for (const delivery of input.cohort) {
    const run = latestRunByDelivery.get(delivery.id);
    if (!run) continue;
    const evals = evaluationsByRequest.get(run.id) ?? [];
    if (evals.some((item) => item.status === "ELIGIBLE")) {
      withEligibleEvaluation += 1;
    }
    if (evals.some((item) => item.quoteAmount != null)) {
      withQuote += 1;
    }
  }

  const bookingSuccess = computeBookingSuccessRate(
    input.cohort.map((row) => row.id),
    input.bookings,
  );
  const currentlyDelivered = input.cohort.filter(
    (row) => row.status === DELIVERED_DELIVERY_STATUS,
  ).length;

  return {
    deliveriesCreated,
    withEligibleEvaluation,
    withQuote,
    withConfirmedBooking: bookingSuccess.deliveriesWithConfirmedBooking,
    currentlyDelivered,
  };
}

export function computePackageTypeDistribution(cohort: DeliveryCohortRow[]) {
  const counts = new Map<string, number>();
  for (const row of cohort) {
    const key = row.packageType ?? "OTHER";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = cohort.length;
  return [...counts.entries()]
    .map(([packageType, count]) => ({
      packageType: packageType as import("@prisma/client").PackageType,
      count,
      percent: total === 0 ? 0 : Math.round((count / total) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count);
}

export function computeTrend(current: number, previous: number): ReportingTrendValue {
  if (previous === 0) {
    return {
      current,
      previous,
      changePercent: current === 0 ? 0 : null,
    };
  }
  const changePercent = Math.round(((current - previous) / previous) * 1000) / 10;
  return { current, previous, changePercent };
}

export function computeTrendNullable(
  current: number | null,
  previous: number | null,
): ReportingTrendValue {
  if (current == null || previous == null) {
    return {
      current: current ?? 0,
      previous: previous ?? 0,
      changePercent: null,
    };
  }
  return computeTrend(current, previous);
}

export function aggregateFailureReasons(runs: OrchestrationRunRow[]) {
  const counts = new Map<string, number>();
  for (const run of runs) {
    if (run.status !== "FAILED") continue;
    const reason = run.failureReason?.trim() || "Unknown";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

export function buildServiceScorecard(input: {
  evaluations: EvaluationRow[];
  bookings: BookingRow[];
}) {
  const byService = new Map<
    string,
    {
      evaluatedCount: number;
      eligibleCount: number;
      selectedCount: number;
      bookingAttemptCount: number;
      confirmedBookingCount: number;
      quoteSum: number;
      quoteCount: number;
    }
  >();

  const ensureBucket = (code: string) => {
    const existing = byService.get(code);
    if (existing) return existing;
    const bucket = {
      evaluatedCount: 0,
      eligibleCount: 0,
      selectedCount: 0,
      bookingAttemptCount: 0,
      confirmedBookingCount: 0,
      quoteSum: 0,
      quoteCount: 0,
    };
    byService.set(code, bucket);
    return bucket;
  };

  for (const evaluation of input.evaluations) {
    const code = evaluation.providerServiceCode ?? "UNKNOWN";
    const bucket = ensureBucket(code);
    bucket.evaluatedCount += 1;
    if (evaluation.status === "ELIGIBLE") bucket.eligibleCount += 1;
    if (evaluation.selected) bucket.selectedCount += 1;
    if (evaluation.quoteAmount != null) {
      bucket.quoteSum += evaluation.quoteAmount;
      bucket.quoteCount += 1;
    }
  }

  for (const booking of input.bookings) {
    const code = booking.providerServiceCode ?? "UNKNOWN";
    const bucket = ensureBucket(code);
    bucket.bookingAttemptCount += 1;
    if (booking.status === "BOOKED") {
      bucket.confirmedBookingCount += 1;
    }
  }

  return [...byService.entries()]
    .map(([providerServiceCode, stats]) => ({
      providerServiceCode,
      evaluatedCount: stats.evaluatedCount,
      eligibleCount: stats.eligibleCount,
      selectedCount: stats.selectedCount,
      bookingAttemptCount: stats.bookingAttemptCount,
      confirmedBookingCount: stats.confirmedBookingCount,
      bookingSuccessRatePercent:
        stats.bookingAttemptCount === 0
          ? null
          : Math.round(
              (stats.confirmedBookingCount / stats.bookingAttemptCount) * 1000,
            ) / 10,
      averageProviderQuoteAmountInr:
        stats.quoteCount === 0
          ? null
          : Math.round((stats.quoteSum / stats.quoteCount) * 100) / 100,
    }))
    .sort((a, b) => b.evaluatedCount - a.evaluatedCount);
}
