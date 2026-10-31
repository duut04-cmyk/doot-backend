import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  PERIOD_GROSS_COLLECTION_STATUSES,
  periodFailedRefundWhere,
  periodGrossCollectionWhere,
  periodPendingRefundWhere,
  periodSuccessfulRefundWhere,
} from "../src/modules/admin-finance/admin-finance.aggregation.js";
import { buildFinanceTimeseries } from "../src/modules/admin-finance/admin-finance.timeseries.js";
import { AdminFinanceService } from "../src/modules/admin-finance/admin-finance.service.js";
import type { AdminFinanceRepository } from "../src/modules/admin-finance/admin-finance.repository.js";
import { subtractMoneyStrings } from "../src/modules/admin-finance/admin-finance.money.js";

const window = {
  from: new Date("2026-01-01T00:00:00.000+05:30"),
  toExclusive: new Date("2026-01-08T00:00:00.000+05:30"),
};

describe("periodGrossCollectionWhere", () => {
  it("includes PAID, PARTIALLY_REFUNDED, and REFUNDED with paidAt half-open window", () => {
    const where = periodGrossCollectionWhere(window);
    expect(where.status).toEqual({ in: [...PERIOD_GROSS_COLLECTION_STATUSES] });
    expect(where.paidAt).toEqual({
      gte: window.from,
      lt: window.toExclusive,
    });
    expect(PERIOD_GROSS_COLLECTION_STATUSES).not.toContain("CREATED");
    expect(PERIOD_GROSS_COLLECTION_STATUSES).not.toContain("PENDING");
  });
});

describe("refund period filters", () => {
  it("uses SUCCESS and processedAt for successful refunds", () => {
    const where = periodSuccessfulRefundWhere(window);
    expect(where.status).toBe("SUCCESS");
    expect(where.processedAt).toEqual({
      gte: window.from,
      lt: window.toExclusive,
    });
  });

  it("uses REQUESTED/PENDING and requestedAt for pending refunds", () => {
    const where = periodPendingRefundWhere(window);
    expect(where.status).toEqual({ in: ["REQUESTED", "PENDING"] });
    expect(where.requestedAt).toEqual({
      gte: window.from,
      lt: window.toExclusive,
    });
    expect(where).not.toHaveProperty("processedAt");
  });

  it("uses FAILED and processedAt for failed refunds, not SUCCESS", () => {
    const where = periodFailedRefundWhere(window);
    expect(where.status).toBe("FAILED");
    expect(where.processedAt).toEqual({
      gte: window.from,
      lt: window.toExclusive,
    });
  });
});

describe("gross collections vs refunds in period", () => {
  it("counts full Payment.amount for PAID, PARTIALLY_REFUNDED, and REFUNDED in timeseries", () => {
    const paidAt = new Date("2026-01-02T10:00:00.000+05:30");
    const points = buildFinanceTimeseries({
      window,
      granularity: "day",
      collections: [
        { paidAt, amount: new Prisma.Decimal("100.00") },
        { paidAt, amount: new Prisma.Decimal("200.00") },
        { paidAt, amount: new Prisma.Decimal("50.00") },
      ],
      successfulRefunds: [],
    });
    const active = points.find((point) => point.collections !== "0.00");
    expect(active?.collections).toBe("350.00");
  });

  it("subtracts only successful refunds processed in period for net activity", async () => {
    const grossCollected = new Prisma.Decimal("350.00");
    const refundProcessed = new Prisma.Decimal("50.00");

    const repository = {
      aggregatePaidCollections: vi.fn().mockResolvedValue({
        _count: { _all: 3 },
        _sum: { amount: grossCollected },
      }),
      aggregateSuccessfulRefunds: vi.fn().mockResolvedValue({
        _count: { _all: 1 },
        _sum: { amount: refundProcessed },
      }),
      aggregatePendingRefundsInWindow: vi.fn().mockResolvedValue({
        _count: { _all: 1 },
        _sum: { amount: new Prisma.Decimal("25.00") },
      }),
      aggregateFailedRefundsInWindow: vi.fn().mockResolvedValue({
        _count: { _all: 1 },
        _sum: { amount: new Prisma.Decimal("10.00") },
      }),
      aggregateLifetimePaidCollections: vi.fn().mockResolvedValue({
        _sum: { amount: grossCollected },
      }),
      aggregateLifetimeSuccessfulRefunds: vi.fn().mockResolvedValue({
        _sum: { amount: refundProcessed },
      }),
    } as unknown as AdminFinanceRepository;

    const service = new AdminFinanceService(repository);
    const result = await service.getSummary(window);

    expect(result.data.collections.totalAmount).toBe("350.00");
    expect(result.data.collections.count).toBe(3);
    expect(result.data.successfulRefunds.totalAmount).toBe("50.00");
    expect(result.data.netActivityInPeriod.amount).toBe(
      subtractMoneyStrings("350.00", "50.00"),
    );
    expect(result.data.failedRefunds.totalAmount).toBe("10.00");
    expect(result.data.pendingRefunds.totalAmount).toBe("25.00");
  });

  it("keeps gross collections unchanged when refunds are processed in the same period", async () => {
    const originalPaymentAmount = new Prisma.Decimal("194.70");
    const repository = {
      aggregatePaidCollections: vi.fn().mockResolvedValue({
        _count: { _all: 1 },
        _sum: { amount: originalPaymentAmount },
      }),
      aggregateSuccessfulRefunds: vi.fn().mockResolvedValue({
        _count: { _all: 1 },
        _sum: { amount: new Prisma.Decimal("194.70") },
      }),
      aggregatePendingRefundsInWindow: vi.fn().mockResolvedValue({
        _count: { _all: 0 },
        _sum: { amount: null },
      }),
      aggregateFailedRefundsInWindow: vi.fn().mockResolvedValue({
        _count: { _all: 0 },
        _sum: { amount: null },
      }),
      aggregateLifetimePaidCollections: vi.fn().mockResolvedValue({
        _sum: { amount: originalPaymentAmount },
      }),
      aggregateLifetimeSuccessfulRefunds: vi.fn().mockResolvedValue({
        _sum: { amount: new Prisma.Decimal("194.70") },
      }),
    } as unknown as AdminFinanceRepository;

    const service = new AdminFinanceService(repository);
    const result = await service.getSummary(window);

    expect(result.data.collections.totalAmount).toBe("194.70");
    expect(result.data.netActivityInPeriod.amount).toBe("0.00");
  });
});
