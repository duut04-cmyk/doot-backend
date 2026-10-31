import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import {
  decimalToMoneyString,
  subtractMoneyStrings,
  sumDecimals,
} from "./admin-finance.money.js";
import { mapPricingBreakdownFromPaymentSource } from "./admin-finance.pricing.js";
import {
  adminFinanceRepository,
  type AdminFinanceRepository,
  type ListPaymentsFilters,
  type ListRefundsFilters,
} from "./admin-finance.repository.js";
import { runInternalReconciliation } from "./admin-finance.reconciliation.js";
import type {
  FinanceWindow,
  ListPaymentsQuery,
  ListRefundsQuery,
} from "./admin-finance.schema.js";
import { toFinanceWindowDto } from "./admin-finance.schema.js";
import { buildFinanceTimeseries } from "./admin-finance.timeseries.js";
import type {
  AdminFinanceSummaryDto,
  AdminFinanceTimeseriesDto,
  AdminPaymentDetailDto,
  AdminPaymentListDto,
  AdminRefundListDto,
  FinanceTimeseriesGranularity,
} from "./admin-finance.types.js";

export class AdminFinanceService {
  constructor(
    private readonly repository: AdminFinanceRepository = adminFinanceRepository,
  ) {}

  async listPayments(
    query: ListPaymentsQuery,
  ): Promise<{ success: true; data: AdminPaymentListDto }> {
    const filters = this.parsePaymentFilters(query);
    const { items, total } = await this.repository.listPayments(
      query.page,
      query.limit,
      filters,
    );
    return {
      success: true,
      data: {
        items,
        page: query.page,
        limit: query.limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
      },
    };
  }

  async getPaymentById(
    paymentId: string,
  ): Promise<{ success: true; data: AdminPaymentDetailDto }> {
    const row = await this.repository.findPaymentDetail(paymentId);
    if (!row) {
      throw new AppError("Payment not found.", {
        statusCode: 404,
        code: ErrorCodes.PAYMENT_NOT_FOUND,
      });
    }

    const successRefunds = row.refunds.filter((refund) => refund.status === "SUCCESS");
    const successTotal = sumDecimals(successRefunds.map((refund) => refund.amount));
    const refundedAmountStr = decimalToMoneyString(row.refundedAmount);
    const matches = successTotal === refundedAmountStr;

    const booking = await this.repository.findLatestProviderBookingForDelivery(
      row.deliveryId,
    );

    const detail: AdminPaymentDetailDto = {
      id: row.id,
      deliveryId: row.deliveryId,
      deliveryReference: row.delivery.reference,
      status: row.status,
      amount: decimalToMoneyString(row.amount),
      currency: row.currency,
      refundedAmount: refundedAmountStr,
      successfulRefundTotal: successTotal,
      refundedAmountMatchesSuccessfulRefunds: matches,
      gateway: row.gateway,
      gatewayOrderId: row.gatewayOrderId,
      gatewayPaymentSessionId: row.gatewayPaymentSessionId,
      paidAt: row.paidAt?.toISOString() ?? null,
      failedAt: row.failedAt?.toISOString() ?? null,
      expiredAt: row.expiredAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      pricingBreakdown: mapPricingBreakdownFromPaymentSource(row.pricingSource),
      providerQuoteBooked: booking
        ? {
            label: "Provider quote / booked (informational)",
            quotedAmount:
              booking.quotedAmount == null
                ? null
                : decimalToMoneyString(booking.quotedAmount),
            quotedCurrency: booking.quotedCurrency,
            bookedAmount:
              booking.bookedAmount == null
                ? null
                : decimalToMoneyString(booking.bookedAmount),
            bookedCurrency: booking.bookedCurrency,
            bookingStatus: booking.status,
            providerCode: booking.providerCode,
            disclaimer:
              "Quoted/booked figures are not actual invoiced provider cost or payout.",
          }
        : null,
      attempts: row.attempts.map((attempt) => this.repository.mapAttempt(attempt)),
      refunds: row.refunds.map((refund) => ({
        id: refund.id,
        paymentId: refund.paymentId,
        deliveryId: refund.deliveryId,
        deliveryReference: row.delivery.reference,
        amount: decimalToMoneyString(refund.amount),
        currency: refund.currency,
        status: refund.status,
        reasonCode: refund.reasonCode,
        gatewayRefundId: refund.gatewayRefundId,
        requestedAt: refund.requestedAt.toISOString(),
        processedAt: refund.processedAt?.toISOString() ?? null,
      })),
      ledgerEntries: row.ledger.map((entry) => this.repository.mapLedger(entry)),
    };

    return { success: true, data: detail };
  }

  async getSummary(
    window: FinanceWindow,
  ): Promise<{ success: true; data: AdminFinanceSummaryDto }> {
    const [
      collectionsAgg,
      successfulRefundsAgg,
      pendingRefundsAgg,
      failedRefundsAgg,
      lifetimeCollectedAgg,
      lifetimeRefundsAgg,
    ] = await Promise.all([
      this.repository.aggregatePaidCollections(window),
      this.repository.aggregateSuccessfulRefunds(window),
      this.repository.aggregatePendingRefundsInWindow(window),
      this.repository.aggregateFailedRefundsInWindow(window),
      this.repository.aggregateLifetimePaidCollections(),
      this.repository.aggregateLifetimeSuccessfulRefunds(),
    ]);

    const collectionsTotal = decimalToMoneyString(collectionsAgg._sum.amount);
    const successfulRefundsTotal = decimalToMoneyString(
      successfulRefundsAgg._sum.amount,
    );
    const currency = "INR";

    const data: AdminFinanceSummaryDto = {
      window: toFinanceWindowDto(window),
      collections: {
        count: collectionsAgg._count._all,
        totalAmount: collectionsTotal,
        currency,
      },
      successfulRefunds: {
        count: successfulRefundsAgg._count._all,
        totalAmount: successfulRefundsTotal,
        currency,
      },
      pendingRefunds: {
        count: pendingRefundsAgg._count._all,
        totalAmount: decimalToMoneyString(pendingRefundsAgg._sum.amount),
        currency,
      },
      failedRefunds: {
        count: failedRefundsAgg._count._all,
        totalAmount: decimalToMoneyString(failedRefundsAgg._sum.amount),
        currency,
      },
      netActivityInPeriod: {
        amount: subtractMoneyStrings(collectionsTotal, successfulRefundsTotal),
        currency,
        formula: "collectionsInPeriod minus successfulRefundsProcessedInPeriod",
      },
      lifetime: {
        totalCollected: decimalToMoneyString(lifetimeCollectedAgg._sum.amount),
        totalSuccessfulRefunds: decimalToMoneyString(lifetimeRefundsAgg._sum.amount),
        net: subtractMoneyStrings(
          decimalToMoneyString(lifetimeCollectedAgg._sum.amount),
          decimalToMoneyString(lifetimeRefundsAgg._sum.amount),
        ),
        currency,
        formula:
          "lifetime gross collected (PAID, PARTIALLY_REFUNDED, REFUNDED with paidAt) minus lifetime SUCCESS refund amounts",
      },
    };

    return { success: true, data };
  }

  async listRefunds(
    query: ListRefundsQuery,
  ): Promise<{ success: true; data: AdminRefundListDto }> {
    const filters = this.parseRefundFilters(query);
    const { items, total } = await this.repository.listRefunds(
      query.page,
      query.limit,
      filters,
    );
    return {
      success: true,
      data: {
        items,
        page: query.page,
        limit: query.limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
      },
    };
  }

  async getTimeseries(input: {
    window: FinanceWindow;
    granularity: FinanceTimeseriesGranularity;
  }): Promise<{ success: true; data: AdminFinanceTimeseriesDto }> {
    const [collections, successfulRefunds] = await Promise.all([
      this.repository.loadTimeseriesCollections(input.window),
      this.repository.loadTimeseriesSuccessfulRefunds(input.window),
    ]);

    const points = buildFinanceTimeseries({
      window: input.window,
      granularity: input.granularity,
      collections: collections
        .filter((row) => row.paidAt != null)
        .map((row) => ({ paidAt: row.paidAt!, amount: row.amount })),
      successfulRefunds: successfulRefunds
        .filter((row) => row.processedAt != null)
        .map((row) => ({ processedAt: row.processedAt!, amount: row.amount })),
    });

    return {
      success: true,
      data: {
        window: toFinanceWindowDto(input.window),
        granularity: input.granularity,
        currency: "INR",
        points,
      },
    };
  }

  async getReconciliation(input: { window: FinanceWindow | null; issueLimit: number }) {
    const data = await this.repository.loadReconciliationData(
      input.window,
      Math.max(input.issueLimit * 2, 100),
    );
    const result = runInternalReconciliation({
      window: input.window,
      payments: data.payments,
      refunds: data.refunds,
      ledgerEntries: data.ledgerEntries,
      issueLimit: input.issueLimit,
    });
    return { success: true as const, data: result };
  }

  private parsePaymentFilters(query: ListPaymentsQuery): ListPaymentsFilters {
    return {
      status: query.status,
      gateway: query.gateway,
      deliveryReference: query.deliveryReference,
      paidFrom: query.paidFrom ? new Date(query.paidFrom) : undefined,
      paidToExclusive: query.paidTo ? new Date(query.paidTo) : undefined,
      search: query.search,
    };
  }

  private parseRefundFilters(query: ListRefundsQuery): ListRefundsFilters {
    return {
      status: query.status,
      deliveryReference: query.deliveryReference,
      processedFrom: query.processedFrom ? new Date(query.processedFrom) : undefined,
      processedToExclusive: query.processedTo ? new Date(query.processedTo) : undefined,
      requestedFrom: query.requestedFrom ? new Date(query.requestedFrom) : undefined,
      requestedToExclusive: query.requestedTo ? new Date(query.requestedTo) : undefined,
      activityFrom: query.activityFrom ? new Date(query.activityFrom) : undefined,
      activityToExclusive: query.activityTo ? new Date(query.activityTo) : undefined,
    };
  }
}

export const adminFinanceService = new AdminFinanceService();
