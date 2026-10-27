import { describe, expect, it } from "vitest";
import type { CustomerSummary } from "../../admin-panel/src/data/customerTypes.ts";
import type { ProviderSummary } from "../../admin-panel/src/data/providerTypes.ts";
import type { ReportingSummary } from "../../admin-panel/src/data/reportingTypes.ts";
import {
  countCustomersAtRisk,
  countProvidersNeedingAttention,
  customerAtRisk,
  getAtRiskCustomers,
  getCustomerAccountabilityRows,
  providerNeedsAttention,
} from "../../admin-panel/src/reports/accountability.ts";
import { mapSnapshotMetrics } from "../../admin-panel/src/reports/liveReportMappers.ts";

const summaryFixture: ReportingSummary = {
  window: {
    from: "2026-01-01T00:00:00.000Z",
    toExclusive: "2026-02-01T00:00:00.000Z",
    timeZone: "Asia/Kolkata",
  },
  deliveriesCreated: {
    total: 10,
    deliveredCurrentStatus: 8,
    deliveredLabel: "Delivered",
    inProgress: 1,
    failed: 1,
    cancelled: 0,
  },
  booking: {
    deliveriesWithBookingAttempt: 9,
    deliveriesWithConfirmedBooking: 9,
    successRatePercent: 90,
    successRateLabel: "90%",
  },
  orchestrationRuns: {
    totalRuns: 10,
    completedRuns: 9,
    failedRuns: 1,
    failureRatePercent: 10,
    averageDurationMs: 1200,
    durationSampleSize: 10,
  },
  funnel: {
    deliveriesCreated: 10,
    withEligibleEvaluation: 9,
    withQuote: 8,
    withConfirmedBooking: 9,
    currentlyDelivered: 8,
    attemptSelectionRule: "latest",
  },
  packageTypeDistribution: [],
  trends: {
    deliveriesCreated: { current: 10, previous: 8, changePercent: 0 },
    deliveredCurrentStatus: { current: 8, previous: 7, changePercent: 0 },
    bookingSuccessRatePercent: { current: 90, previous: 88, changePercent: 0 },
    averageOrchestrationDurationMs: { current: 1200, previous: 1300, changePercent: 0 },
  },
};

function provider(overrides: Partial<ProviderSummary> = {}): ProviderSummary {
  return {
    id: "p1",
    code: "MOCK",
    name: "Mock",
    displayName: null,
    environment: "SANDBOX",
    status: "ACTIVE",
    enabled: true,
    orchestrationEnabled: true,
    priority: 100,
    integrationStatus: "CONFIGURED",
    orchestrationEligible: true,
    health: { status: "HEALTHY", lastCheckedAt: null, lastError: null },
    credentials: { configured: true, fields: [] },
    capabilities: ["BOOKING"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function customer(overrides: Partial<CustomerSummary> = {}): CustomerSummary {
  return {
    id: "c1",
    name: "Test User",
    email: "test@example.com",
    phone: null,
    emailVerified: true,
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    oauthProviders: [],
    stats: { totalDeliveries: 0, lastDeliveryAt: null },
    ...overrides,
  };
}

describe("admin-panel live report risk rules", () => {
  it("flags providers using documented attention rules", () => {
    expect(
      providerNeedsAttention(
        provider({
          health: { status: "UNHEALTHY", lastCheckedAt: null, lastError: "down" },
        }),
      ),
    ).toBe(true);
    expect(providerNeedsAttention(provider({ integrationStatus: "ERROR" }))).toBe(true);
    expect(
      providerNeedsAttention(
        provider({
          enabled: true,
          orchestrationEnabled: false,
          orchestrationEligible: true,
        }),
      ),
    ).toBe(true);
    expect(providerNeedsAttention(provider())).toBe(false);
  });

  it("flags customers using documented at-risk rules", () => {
    expect(customerAtRisk(customer({ status: "SUSPENDED" }))).toBe(true);
    expect(
      customerAtRisk(
        customer({
          emailVerified: false,
          stats: { totalDeliveries: 2, lastDeliveryAt: null },
        }),
      ),
    ).toBe(true);
    expect(
      customerAtRisk(
        customer({
          emailVerified: false,
          stats: { totalDeliveries: 0, lastDeliveryAt: null },
        }),
      ),
    ).toBe(false);
  });

  it("maps snapshot provider count across all loaded providers", () => {
    const metrics = mapSnapshotMetrics(summaryFixture, 2, {
      providers: [provider(), provider({ integrationStatus: "ERROR" })],
      customers: null,
    });
    expect(metrics.providersNeedingAttention).toBe(1);
    expect(metrics.providersNeedingAttentionKnown).toBe(true);
    expect(metrics.customerRiskCountKnown).toBe(false);
  });

  it("treats missing provider source as unknown not zero", () => {
    const metrics = mapSnapshotMetrics(summaryFixture, 0, {
      providers: null,
      customers: [],
    });
    expect(metrics.providersNeedingAttentionKnown).toBe(false);
    expect(metrics.providersNeedingAttention).toBe(0);
  });

  it("counts customer risk from loaded sample only", () => {
    const customers = [customer(), customer({ status: "SUSPENDED" })];
    expect(countCustomersAtRisk(customers)).toBe(1);
    const metrics = mapSnapshotMetrics(summaryFixture, 0, {
      providers: [],
      customers,
    });
    expect(metrics.customerRiskCount).toBe(1);
    expect(metrics.customerRiskCountIsSample).toBe(true);
  });

  it("derives at-risk rows from accountability row notes", () => {
    const rows = getCustomerAccountabilityRows([
      customer(),
      customer({ status: "SUSPENDED" }),
      customer({
        emailVerified: false,
        stats: { totalDeliveries: 3, lastDeliveryAt: "2026-01-02T00:00:00.000Z" },
      }),
    ]);
    const atRisk = getAtRiskCustomers(rows);
    expect(atRisk).toHaveLength(2);
    expect(countProvidersNeedingAttention([])).toBe(0);
  });
});
