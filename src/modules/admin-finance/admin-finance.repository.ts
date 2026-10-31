import type {
  PaymentGatewayCode,
  PaymentStatus,
  Prisma,
  RefundStatus,
} from "@prisma/client";
import { getPrismaClient } from "../../config/database.js";
import {
  periodFailedRefundWhere,
  periodGrossCollectionWhere,
  periodPendingRefundWhere,
  periodSuccessfulRefundWhere,
} from "./admin-finance.aggregation.js";
import { mergeRefundListWhere } from "./admin-finance.refund-list-filters.js";
import { decimalToMoneyString } from "./admin-finance.money.js";
import type {
  ReconciliationLedgerRow,
  ReconciliationPaymentRow,
  ReconciliationRefundRow,
} from "./admin-finance.reconciliation.js";
import type { FinanceWindow } from "./admin-finance.schema.js";
import type {
  AdminFinanceAttemptDto,
  AdminFinanceLedgerDto,
  AdminFinanceRefundDto,
  AdminPaymentListItemDto,
} from "./admin-finance.types.js";

export type ListPaymentsFilters = {
  status?: PaymentStatus;
  gateway?: PaymentGatewayCode;
  deliveryReference?: string;
  paidFrom?: Date;
  paidToExclusive?: Date;
  search?: string;
  /** Resolved payment IDs when search is a UUID / PAY- hex prefix. */
  searchPaymentIds?: string[];
};

export type ListRefundsFilters = {
  status?: RefundStatus;
  deliveryReference?: string;
  processedFrom?: Date;
  processedToExclusive?: Date;
  requestedFrom?: Date;
  requestedToExclusive?: Date;
  activityFrom?: Date;
  activityToExclusive?: Date;
};

export class AdminFinanceRepository {
  async listPayments(
    page: number,
    limit: number,
    filters: ListPaymentsFilters,
  ): Promise<{ items: AdminPaymentListItemDto[]; total: number }> {
    const resolved = await this.resolvePaymentSearchFilters(filters);
    const where = this.buildPaymentListWhere(resolved);
    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      getPrismaClient().payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          deliveryId: true,
          status: true,
          amount: true,
          currency: true,
          refundedAmount: true,
          gateway: true,
          gatewayOrderId: true,
          paidAt: true,
          createdAt: true,
          delivery: {
            select: {
              reference: true,
              customer: { select: { name: true } },
            },
          },
        },
      }),
      getPrismaClient().payment.count({ where }),
    ]);

    return {
      total,
      items: rows.map((row) => ({
        id: row.id,
        deliveryId: row.deliveryId,
        deliveryReference: row.delivery.reference,
        customerName: row.delivery.customer.name.trim() || null,
        status: row.status,
        amount: decimalToMoneyString(row.amount),
        currency: row.currency,
        refundedAmount: decimalToMoneyString(row.refundedAmount),
        gateway: row.gateway,
        gatewayOrderId: row.gatewayOrderId,
        paidAt: row.paidAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async findPaymentDetail(paymentId: string) {
    return getPrismaClient().payment.findUnique({
      where: { id: paymentId },
      include: {
        delivery: { select: { reference: true } },
        attempts: { orderBy: { attemptNumber: "asc" } },
        refunds: { orderBy: { requestedAt: "desc" } },
        ledger: { orderBy: { createdAt: "asc" } },
      },
    });
  }

  async findLatestProviderBookingForDelivery(deliveryId: string) {
    return getPrismaClient().providerBooking.findFirst({
      where: { deliveryId },
      orderBy: [{ attemptNumber: "desc" }, { createdAt: "desc" }],
      select: {
        status: true,
        providerCode: true,
        quotedAmount: true,
        quotedCurrency: true,
        bookedAmount: true,
        bookedCurrency: true,
      },
    });
  }

  async aggregatePaidCollections(window: FinanceWindow) {
    return getPrismaClient().payment.aggregate({
      where: periodGrossCollectionWhere(window),
      _count: { _all: true },
      _sum: { amount: true },
    });
  }

  async aggregateLifetimePaidCollections() {
    return getPrismaClient().payment.aggregate({
      where: {
        paidAt: { not: null },
        status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] },
      },
      _sum: { amount: true },
    });
  }

  async aggregateSuccessfulRefunds(window: FinanceWindow) {
    return getPrismaClient().refund.aggregate({
      where: periodSuccessfulRefundWhere(window),
      _count: { _all: true },
      _sum: { amount: true },
    });
  }

  async aggregateLifetimeSuccessfulRefunds() {
    return getPrismaClient().refund.aggregate({
      where: { status: "SUCCESS" },
      _sum: { amount: true },
    });
  }

  async aggregatePendingRefundsInWindow(window: FinanceWindow) {
    return getPrismaClient().refund.aggregate({
      where: periodPendingRefundWhere(window),
      _count: { _all: true },
      _sum: { amount: true },
    });
  }

  async aggregateFailedRefundsInWindow(window: FinanceWindow) {
    return getPrismaClient().refund.aggregate({
      where: periodFailedRefundWhere(window),
      _count: { _all: true },
      _sum: { amount: true },
    });
  }

  async listRefunds(
    page: number,
    limit: number,
    filters: ListRefundsFilters,
  ): Promise<{ items: AdminFinanceRefundDto[]; total: number }> {
    const where = this.buildRefundListWhere(filters);
    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      getPrismaClient().refund.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ processedAt: "desc" }, { requestedAt: "desc" }],
        select: {
          id: true,
          paymentId: true,
          deliveryId: true,
          amount: true,
          currency: true,
          status: true,
          reasonCode: true,
          gatewayRefundId: true,
          requestedAt: true,
          processedAt: true,
          payment: {
            select: { delivery: { select: { reference: true } } },
          },
        },
      }),
      getPrismaClient().refund.count({ where }),
    ]);

    return {
      total,
      items: rows.map((row) => this.mapRefundRow(row)),
    };
  }

  async loadTimeseriesCollections(window: FinanceWindow) {
    return getPrismaClient().payment.findMany({
      where: periodGrossCollectionWhere(window),
      select: { paidAt: true, amount: true },
    });
  }

  async loadTimeseriesSuccessfulRefunds(window: FinanceWindow) {
    return getPrismaClient().refund.findMany({
      where: periodSuccessfulRefundWhere(window),
      select: { processedAt: true, amount: true },
    });
  }

  async loadReconciliationData(window: FinanceWindow | null, paymentLimit: number) {
    const paymentWhere: Prisma.PaymentWhereInput = window
      ? {
          OR: [
            { paidAt: { gte: window.from, lt: window.toExclusive } },
            {
              refunds: {
                some: {
                  OR: [
                    {
                      status: "SUCCESS",
                      processedAt: { gte: window.from, lt: window.toExclusive },
                    },
                    {
                      requestedAt: { gte: window.from, lt: window.toExclusive },
                    },
                  ],
                },
              },
            },
            {
              ledger: {
                some: {
                  createdAt: { gte: window.from, lt: window.toExclusive },
                },
              },
            },
          ],
        }
      : {};

    const payments = await getPrismaClient().payment.findMany({
      where: paymentWhere,
      take: paymentLimit,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        deliveryId: true,
        status: true,
        amount: true,
        refundedAmount: true,
        paidAt: true,
      },
    });

    const paymentIds = payments.map((row) => row.id);
    if (paymentIds.length === 0) {
      return {
        payments: [] as ReconciliationPaymentRow[],
        refunds: [] as ReconciliationRefundRow[],
        ledgerEntries: [] as ReconciliationLedgerRow[],
      };
    }

    const [refunds, ledgerEntries] = await Promise.all([
      getPrismaClient().refund.findMany({
        where: { paymentId: { in: paymentIds } },
        select: {
          id: true,
          paymentId: true,
          deliveryId: true,
          amount: true,
          status: true,
          processedAt: true,
        },
      }),
      getPrismaClient().ledgerEntry.findMany({
        where: { paymentId: { in: paymentIds } },
        select: {
          id: true,
          paymentId: true,
          refundId: true,
          deliveryId: true,
          type: true,
          direction: true,
          amount: true,
          idempotencyKey: true,
        },
      }),
    ]);

    return {
      payments: payments as ReconciliationPaymentRow[],
      refunds: refunds as ReconciliationRefundRow[],
      ledgerEntries: ledgerEntries as ReconciliationLedgerRow[],
    };
  }

  mapAttempt(row: {
    id: string;
    attemptNumber: number;
    status: AdminFinanceAttemptDto["status"];
    amount: Prisma.Decimal;
    currency: AdminFinanceAttemptDto["currency"];
    gatewayPaymentId: string | null;
    paymentMethod: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
  }): AdminFinanceAttemptDto {
    return {
      id: row.id,
      attemptNumber: row.attemptNumber,
      status: row.status,
      amount: decimalToMoneyString(row.amount),
      currency: row.currency,
      gatewayPaymentId: row.gatewayPaymentId,
      paymentMethod: row.paymentMethod,
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }

  mapLedger(row: {
    id: string;
    type: AdminFinanceLedgerDto["type"];
    direction: AdminFinanceLedgerDto["direction"];
    amount: Prisma.Decimal;
    currency: AdminFinanceLedgerDto["currency"];
    refundId: string | null;
    idempotencyKey: string;
    description: string | null;
    createdAt: Date;
  }): AdminFinanceLedgerDto {
    return {
      id: row.id,
      type: row.type,
      direction: row.direction,
      amount: decimalToMoneyString(row.amount),
      currency: row.currency,
      refundId: row.refundId,
      idempotencyKey: row.idempotencyKey,
      description: row.description,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapRefundRow(row: {
    id: string;
    paymentId: string;
    deliveryId: string;
    amount: Prisma.Decimal;
    currency: AdminFinanceRefundDto["currency"];
    status: RefundStatus;
    reasonCode: string | null;
    gatewayRefundId: string | null;
    requestedAt: Date;
    processedAt: Date | null;
    payment: { delivery: { reference: string } };
  }): AdminFinanceRefundDto {
    return {
      id: row.id,
      paymentId: row.paymentId,
      deliveryId: row.deliveryId,
      deliveryReference: row.payment.delivery.reference,
      amount: decimalToMoneyString(row.amount),
      currency: row.currency,
      status: row.status,
      reasonCode: row.reasonCode,
      gatewayRefundId: row.gatewayRefundId,
      requestedAt: row.requestedAt.toISOString(),
      processedAt: row.processedAt?.toISOString() ?? null,
    };
  }

  private async resolvePaymentSearchFilters(
    filters: ListPaymentsFilters,
  ): Promise<ListPaymentsFilters> {
    const term = filters.search?.trim();
    if (!term) {
      return filters;
    }
    const fullUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        term,
      );
    if (fullUuid) {
      return filters;
    }
    if (/^[0-9a-f]{6,32}$/i.test(term)) {
      const prefix = term.toLowerCase();
      const rows = await getPrismaClient().$queryRaw<Array<{ id: string }>>`
        SELECT id::text AS id
        FROM "Payment"
        WHERE LOWER(id::text) LIKE ${`${prefix}%`}
        LIMIT 50
      `;
      const { search: _search, ...rest } = filters;
      return {
        ...rest,
        searchPaymentIds: rows.map((row) => row.id),
      };
    }
    return filters;
  }

  private buildPaymentListWhere(
    filters: ListPaymentsFilters,
  ): Prisma.PaymentWhereInput {
    const where: Prisma.PaymentWhereInput = {};
    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.gateway) {
      where.gateway = filters.gateway;
    }
    if (filters.deliveryReference) {
      where.delivery = { reference: filters.deliveryReference };
    }
    if (filters.paidFrom || filters.paidToExclusive) {
      where.paidAt = {};
      if (filters.paidFrom) {
        where.paidAt.gte = filters.paidFrom;
      }
      if (filters.paidToExclusive) {
        where.paidAt.lt = filters.paidToExclusive;
      }
    }
    if (filters.searchPaymentIds) {
      where.id = { in: filters.searchPaymentIds };
    } else if (filters.search) {
      const term = filters.search.trim();
      const or: Prisma.PaymentWhereInput[] = [
        { gatewayOrderId: { contains: term, mode: "insensitive" } },
        { delivery: { reference: { contains: term, mode: "insensitive" } } },
      ];
      if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          term,
        )
      ) {
        or.push({ id: term });
      }
      where.OR = or;
    }
    return where;
  }

  private buildRefundListWhere(filters: ListRefundsFilters): Prisma.RefundWhereInput {
    return mergeRefundListWhere({
      status: filters.status,
      deliveryReference: filters.deliveryReference,
      processedFrom: filters.processedFrom,
      processedToExclusive: filters.processedToExclusive,
      requestedFrom: filters.requestedFrom,
      requestedToExclusive: filters.requestedToExclusive,
      activityFrom: filters.activityFrom,
      activityToExclusive: filters.activityToExclusive,
    });
  }
}

export const adminFinanceRepository = new AdminFinanceRepository();
