import type { DeliveryStatus, PackageType } from "@prisma/client";

export type ReportingTrendValue = {
  current: number;
  previous: number;
  changePercent: number | null;
};

export type ReportingSummaryDto = {
  window: {
    from: string;
    toExclusive: string;
    timeZone: "Asia/Kolkata";
  };
  deliveriesCreated: {
    total: number;
    deliveredCurrentStatus: number;
    deliveredLabel: "Deliveries created in period that are currently delivered";
    inProgress: number;
    cancelled: number;
    failed: number;
  };
  booking: {
    deliveriesWithBookingAttempt: number;
    deliveriesWithConfirmedBooking: number;
    successRatePercent: number | null;
    successRateLabel: string;
  };
  orchestrationRuns: {
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    failureRatePercent: number | null;
    averageDurationMs: number | null;
    durationSampleSize: number;
  };
  funnel: {
    deliveriesCreated: number;
    withEligibleEvaluation: number;
    withQuote: number;
    withConfirmedBooking: number;
    currentlyDelivered: number;
    attemptSelectionRule: string;
  };
  packageTypeDistribution: Array<{
    packageType: PackageType;
    count: number;
    percent: number;
  }>;
  trends: {
    deliveriesCreated: ReportingTrendValue;
    deliveredCurrentStatus: ReportingTrendValue;
    bookingSuccessRatePercent: ReportingTrendValue;
    orchestrationFailureRatePercent: ReportingTrendValue;
    averageOrchestrationDurationMs: ReportingTrendValue;
  };
};

export type OrchestrationReportingDto = {
  window: { from: string; toExclusive: string };
  runsByStatus: Record<string, number>;
  failureReasons: Array<{ reason: string; count: number }>;
  serviceScorecard: Array<{
    providerServiceCode: string;
    evaluatedCount: number;
    eligibleCount: number;
    selectedCount: number;
    bookingAttemptCount: number;
    confirmedBookingCount: number;
    bookingSuccessRatePercent: number | null;
    averageProviderQuoteAmountInr: number | null;
    providerQuoteLabel: "Provider quote amount (INR), not customer revenue";
    bookingSuccessRateLabel: "BOOKED provider booking attempts / all provider booking attempts in window (UNKNOWN and FAILED are not success)";
  }>;
};

export type RecentDeliveryReportingItemDto = {
  deliveryId: string;
  reference: string;
  status: DeliveryStatus;
  packageType: PackageType | null;
  createdAt: string;
  routeLabel: string | null;
};

export type RecentDeliveriesReportingDto = {
  items: RecentDeliveryReportingItemDto[];
};

export type RecentActivityItemDto = {
  eventId: string;
  deliveryId: string;
  deliveryReference: string;
  fromStatus: DeliveryStatus | null;
  toStatus: DeliveryStatus;
  occurredAt: string;
  summary: string;
};

export type RecentActivityReportingDto = {
  hours: number;
  items: RecentActivityItemDto[];
};

export type FeedbackTagCountDto = {
  tag: string;
  count: number;
};

export type RecentFeedbackSnippetDto = {
  deliveryId: string;
  deliveryReference: string;
  submittedAt: string;
  driverRating: number;
  deliveryRating: number;
  issueTagCount: number;
  positiveTagCount: number;
};

export type FeedbackReportingDto = {
  window: { from: string; toExclusive: string };
  feedbackCount: number;
  averageDriverRating: number | null;
  averageDeliveryRating: number | null;
  topIssueTags: FeedbackTagCountDto[];
  topPositiveTags: FeedbackTagCountDto[];
  recentSnippets: RecentFeedbackSnippetDto[];
};
