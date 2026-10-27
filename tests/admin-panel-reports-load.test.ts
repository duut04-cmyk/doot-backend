import { describe, expect, it } from "vitest";
import type { CustomerSummary } from "../../admin-panel/src/data/customerTypes.ts";
import type {
  FeedbackReporting,
  OrchestrationReporting,
  ReportingSummary,
} from "../../admin-panel/src/data/reportingTypes.ts";
import type { ProviderSummary } from "../../admin-panel/src/data/providerTypes.ts";
import {
  assembleReportsLoadResult,
  reportsPartialFailureMessage,
} from "../../admin-panel/src/reports/reportsLoad.ts";

const summary: ReportingSummary = {
  window: {
    from: "2026-01-01T00:00:00.000Z",
    toExclusive: "2026-02-01T00:00:00.000Z",
    timeZone: "Asia/Kolkata",
  },
  deliveriesCreated: {
    total: 1,
    deliveredCurrentStatus: 1,
    deliveredLabel: "Delivered",
    inProgress: 0,
    failed: 0,
    cancelled: 0,
  },
  booking: {
    deliveriesWithBookingAttempt: 1,
    deliveriesWithConfirmedBooking: 1,
    successRatePercent: 100,
    successRateLabel: "100%",
  },
  orchestrationRuns: {
    totalRuns: 1,
    completedRuns: 1,
    failedRuns: 0,
    failureRatePercent: 0,
    averageDurationMs: 500,
    durationSampleSize: 1,
  },
  funnel: {
    deliveriesCreated: 1,
    withEligibleEvaluation: 1,
    withQuote: 1,
    withConfirmedBooking: 1,
    currentlyDelivered: 1,
    attemptSelectionRule: "latest",
  },
  packageTypeDistribution: [],
  trends: {
    deliveriesCreated: { current: 1, previous: 0, changePercent: null },
    deliveredCurrentStatus: { current: 1, previous: 0, changePercent: null },
    bookingSuccessRatePercent: { current: 100, previous: 0, changePercent: null },
    averageOrchestrationDurationMs: { current: 500, previous: 0, changePercent: null },
  },
};

const orchestration: OrchestrationReporting = {
  runsByStatus: { COMPLETED: 1 },
  failureReasons: [],
  serviceScorecard: [],
};

const feedback: FeedbackReporting = {
  feedbackCount: 0,
  averageDriverRating: null,
  averageDeliveryRating: null,
  topPositiveTags: [],
  topIssueTags: [],
  recentSnippets: [],
};

const providers: ProviderSummary[] = [];
const customers: CustomerSummary[] = [];

describe("admin-panel reports load assembly", () => {
  it("succeeds when all sources succeed", () => {
    const result = assembleReportsLoadResult({
      summaryResult: { success: true, data: summary },
      orchestrationResult: { success: true, data: orchestration },
      feedbackResult: { success: true, data: feedback },
      providersResult: { success: true, data: providers },
      customersResult: { success: true, data: { items: customers, total: 0 } },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.failedSections).toEqual([]);
    expect(reportsPartialFailureMessage(result.failedSections)).toBeNull();
  });

  it("fails when primary summary fails", () => {
    const result = assembleReportsLoadResult({
      summaryResult: { success: false, error: "Summary unavailable" },
      orchestrationResult: { success: true, data: orchestration },
      feedbackResult: { success: true, data: feedback },
      providersResult: { success: true, data: providers },
      customersResult: { success: true, data: { items: customers, total: 0 } },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("Summary");
  });

  it("succeeds with one secondary failure", () => {
    const result = assembleReportsLoadResult({
      summaryResult: { success: true, data: summary },
      orchestrationResult: {
        success: false,
        error: "Internal token leak should not show",
      },
      feedbackResult: { success: true, data: feedback },
      providersResult: { success: true, data: providers },
      customersResult: { success: true, data: { items: customers, total: 0 } },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.failedSections).toEqual(["orchestration"]);
    expect(result.orchestration).toBeNull();
    expect(reportsPartialFailureMessage(result.failedSections)).toContain(
      "Orchestration accountability",
    );
  });

  it("succeeds with multiple secondary failures including customers", () => {
    const result = assembleReportsLoadResult({
      summaryResult: { success: true, data: summary },
      orchestrationResult: { success: false },
      feedbackResult: { success: false },
      providersResult: { success: false },
      customersResult: { success: false },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.failedSections.sort()).toEqual(
      ["customers", "feedback", "orchestration", "providers"].sort(),
    );
    expect(reportsPartialFailureMessage(result.failedSections)).toContain(
      "These sections could not be loaded",
    );
  });

  it("treats successful empty datasets as loaded not failed", () => {
    const result = assembleReportsLoadResult({
      summaryResult: { success: true, data: summary },
      orchestrationResult: { success: true, data: orchestration },
      feedbackResult: { success: true, data: feedback },
      providersResult: { success: true, data: [] },
      customersResult: { success: true, data: { items: [], total: 0 } },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.failedSections).toEqual([]);
    expect(result.providers).toEqual([]);
    expect(result.customers).toEqual([]);
  });
});
