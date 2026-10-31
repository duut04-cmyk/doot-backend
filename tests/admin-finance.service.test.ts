import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { AdminFinanceService } from "../src/modules/admin-finance/admin-finance.service.js";
import type { AdminFinanceRepository } from "../src/modules/admin-finance/admin-finance.repository.js";
import { buildFinanceTimeseries } from "../src/modules/admin-finance/admin-finance.timeseries.js";
import { subtractMoneyStrings } from "../src/modules/admin-finance/admin-finance.money.js";

describe("AdminFinanceService", () => {
  const window = {
    from: new Date("2026-01-01T00:00:00.000+05:30"),
    toExclusive: new Date("2026-01-08T00:00:00.000+05:30"),
  };

  it("computes summary net activity from decimal strings", async () => {
    const repository = {
      aggregatePaidCollections: vi.fn().mockResolvedValue({
        _count: { _all: 2 },
        _sum: { amount: new Prisma.Decimal("200.50") },
      }),
      aggregateSuccessfulRefunds: vi.fn().mockResolvedValue({
        _count: { _all: 1 },
        _sum: { amount: new Prisma.Decimal("50.25") },
      }),
      aggregatePendingRefundsInWindow: vi.fn().mockResolvedValue({
        _count: { _all: 1 },
        _sum: { amount: new Prisma.Decimal("10.00") },
      }),
      aggregateFailedRefundsInWindow: vi.fn().mockResolvedValue({
        _count: { _all: 0 },
        _sum: { amount: null },
      }),
      aggregateLifetimePaidCollections: vi.fn().mockResolvedValue({
        _sum: { amount: new Prisma.Decimal("500.00") },
      }),
      aggregateLifetimeSuccessfulRefunds: vi.fn().mockResolvedValue({
        _sum: { amount: new Prisma.Decimal("100.00") },
      }),
    } as unknown as AdminFinanceRepository;

    const service = new AdminFinanceService(repository);
    const result = await service.getSummary(window);

    expect(result.data.collections.totalAmount).toBe("200.50");
    expect(result.data.successfulRefunds.totalAmount).toBe("50.25");
    expect(result.data.netActivityInPeriod.amount).toBe(
      subtractMoneyStrings("200.50", "50.25"),
    );
    expect(result.data.lifetime.net).toBe("400.00");
    expect(result.data.pendingRefunds.count).toBe(1);
  });

  it("maps pricing breakdown from frozen pricingSource only", async () => {
    const repository = {
      findPaymentDetail: vi.fn().mockResolvedValue({
        id: "pay-1",
        deliveryId: "del-1",
        delivery: { reference: "DOTT-1" },
        status: "PAID",
        amount: new Prisma.Decimal("194.70"),
        currency: "INR",
        refundedAmount: new Prisma.Decimal(0),
        gateway: "STUB",
        gatewayOrderId: "ord-1",
        gatewayPaymentSessionId: null,
        paidAt: new Date(),
        failedAt: null,
        expiredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        pricingSource: {
          orchestrationRequestId: "orch-1",
          orchestrationOptionId: "opt-1",
          quoteSnapshot: {
            amount: 150,
            currency: "INR",
            providerQuoteAmount: 150,
            platformFeePercent: 10,
            platformFeeAmount: 15,
            gstAmount: 29.7,
            customerPayableAmount: 194.7,
          },
        },
        attempts: [],
        refunds: [],
        ledger: [],
      }),
      findLatestProviderBookingForDelivery: vi.fn().mockResolvedValue(null),
    } as unknown as AdminFinanceRepository;

    const service = new AdminFinanceService(repository);
    const result = await service.getPaymentById("pay-1");
    expect(result.data.pricingBreakdown?.customerPayableAmount).toBe("194.70");
    expect(result.data.pricingBreakdown?.label).toBe("Pricing Breakdown");
  });
});

describe("buildFinanceTimeseries", () => {
  it("uses half-open window buckets with decimal precision", () => {
    const window = {
      from: new Date("2026-01-01T00:00:00.000+05:30"),
      toExclusive: new Date("2026-01-03T00:00:00.000+05:30"),
    };
    const points = buildFinanceTimeseries({
      window,
      granularity: "day",
      collections: [
        {
          paidAt: new Date("2026-01-01T12:00:00.000+05:30"),
          amount: new Prisma.Decimal("10.10"),
        },
      ],
      successfulRefunds: [
        {
          processedAt: new Date("2026-01-01T18:00:00.000+05:30"),
          amount: new Prisma.Decimal("2.05"),
        },
      ],
    });
    expect(points.length).toBeGreaterThan(0);
    const day = points.find((point) => point.collections !== "0.00");
    expect(day?.collections).toBe("10.10");
    expect(day?.successfulRefunds).toBe("2.05");
    expect(day?.net).toBe("8.05");
  });
});
