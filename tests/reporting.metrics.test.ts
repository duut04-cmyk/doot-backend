import { describe, expect, it } from "vitest";
import {
  buildServiceScorecard,
  computeBookingSuccessRate,
  computeFunnelCounts,
  computeOrchestrationRunStats,
  computeTrend,
  pickLatestCompletedRunPerDelivery,
  type BookingRow,
  type DeliveryCohortRow,
  type EvaluationRow,
  type OrchestrationRunRow,
} from "../src/modules/admin-reporting/reporting.metrics.js";

describe("reporting.metrics", () => {
  it("does not count UNKNOWN booking as successful", () => {
    const result = computeBookingSuccessRate(
      ["d1", "d2"],
      [
        { deliveryId: "d1", status: "BOOKED", providerServiceCode: "MOCK_BIKE" },
        { deliveryId: "d2", status: "UNKNOWN", providerServiceCode: "MOCK_BIKE" },
      ],
    );
    expect(result.deliveriesWithBookingAttempt).toBe(2);
    expect(result.deliveriesWithConfirmedBooking).toBe(1);
    expect(result.successRatePercent).toBe(50);
  });

  it("selects latest completed orchestration attempt deterministically", () => {
    const runs: OrchestrationRunRow[] = [
      {
        id: "a",
        deliveryId: "d1",
        status: "COMPLETED",
        failureReason: null,
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        completedAt: new Date("2026-01-01T00:01:00.000Z"),
        attemptNumber: 1,
      },
      {
        id: "b",
        deliveryId: "d1",
        status: "COMPLETED",
        failureReason: null,
        startedAt: new Date("2026-01-02T00:00:00.000Z"),
        completedAt: new Date("2026-01-02T00:01:00.000Z"),
        attemptNumber: 2,
      },
    ];
    const picked = pickLatestCompletedRunPerDelivery(runs);
    expect(picked.get("d1")?.id).toBe("b");
  });

  it("computes funnel without inflating delivery counts for multiple attempts", () => {
    const cohort: DeliveryCohortRow[] = [
      { id: "d1", status: "DELIVERED", packageType: "FOOD" },
    ];
    const runs: OrchestrationRunRow[] = [
      {
        id: "run-1",
        deliveryId: "d1",
        status: "COMPLETED",
        failureReason: null,
        startedAt: new Date(),
        completedAt: new Date(),
        attemptNumber: 1,
      },
      {
        id: "run-2",
        deliveryId: "d1",
        status: "FAILED",
        failureReason: "x",
        startedAt: new Date(),
        completedAt: new Date(),
        attemptNumber: 2,
      },
    ];
    const evaluations: EvaluationRow[] = [
      {
        orchestrationRequestId: "run-2",
        deliveryId: "d1",
        status: "INELIGIBLE",
        quoteAmount: null,
        providerServiceCode: "MOCK_BIKE",
        selected: false,
      },
      {
        orchestrationRequestId: "run-1",
        deliveryId: "d1",
        status: "ELIGIBLE",
        quoteAmount: 100,
        providerServiceCode: "MOCK_BIKE",
        selected: true,
      },
    ];
    const bookings: BookingRow[] = [
      { deliveryId: "d1", status: "BOOKED", providerServiceCode: "MOCK_BIKE" },
    ];
    const funnel = computeFunnelCounts({ cohort, runs, evaluations, bookings });
    expect(funnel.deliveriesCreated).toBe(1);
    expect(funnel.withEligibleEvaluation).toBe(1);
    expect(funnel.withQuote).toBe(1);
    expect(funnel.withConfirmedBooking).toBe(1);
    expect(funnel.currentlyDelivered).toBe(1);
  });

  it("excludes incomplete orchestration durations from averages", () => {
    const stats = computeOrchestrationRunStats([
      {
        id: "1",
        deliveryId: "d1",
        status: "COMPLETED",
        failureReason: null,
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        completedAt: new Date("2026-01-01T00:00:02.000Z"),
        attemptNumber: 1,
      },
      {
        id: "2",
        deliveryId: "d2",
        status: "COMPLETED",
        failureReason: null,
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        completedAt: null,
        attemptNumber: 1,
      },
    ]);
    expect(stats.durationSampleSize).toBe(1);
    expect(stats.averageDurationMs).toBe(2000);
  });

  it("computes prior-period trend deltas", () => {
    expect(computeTrend(10, 5).changePercent).toBe(100);
    expect(computeTrend(0, 0).changePercent).toBe(0);
  });

  it("derives per-service booking success from provider booking records", () => {
    const scorecard = buildServiceScorecard({
      evaluations: [
        {
          orchestrationRequestId: "run-1",
          deliveryId: "d1",
          status: "ELIGIBLE",
          quoteAmount: 100,
          providerServiceCode: "MOCK_BIKE",
          selected: true,
        },
      ],
      bookings: [
        {
          deliveryId: "d1",
          status: "BOOKED",
          providerServiceCode: "MOCK_BIKE",
        },
        {
          deliveryId: "d2",
          status: "UNKNOWN",
          providerServiceCode: "MOCK_BIKE",
        },
      ],
    });
    const row = scorecard.find((entry) => entry.providerServiceCode === "MOCK_BIKE");
    expect(row?.bookingAttemptCount).toBe(2);
    expect(row?.confirmedBookingCount).toBe(1);
    expect(row?.bookingSuccessRatePercent).toBe(50);
    expect(row?.selectedCount).toBe(1);
  });
});
