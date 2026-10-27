import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "../../config/database.js";
import type {
  BookingRow,
  DeliveryCohortRow,
  EvaluationRow,
  OrchestrationRunRow,
} from "./reporting.metrics.js";

export type ReportingWindow = {
  from: Date;
  toExclusive: Date;
};

function deliveryCreatedWhere(window: ReportingWindow): Prisma.DeliveryWhereInput {
  return {
    createdAt: {
      gte: window.from,
      lt: window.toExclusive,
    },
  };
}

function orchestrationCreatedWhere(
  window: ReportingWindow,
): Prisma.OrchestrationRequestWhereInput {
  return {
    createdAt: {
      gte: window.from,
      lt: window.toExclusive,
    },
  };
}

export class ReportingRepository {
  async loadDeliveryCohort(window: ReportingWindow): Promise<DeliveryCohortRow[]> {
    const rows = await getPrismaClient().delivery.findMany({
      where: deliveryCreatedWhere(window),
      select: {
        id: true,
        status: true,
        package: { select: { packageType: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      packageType: row.package?.packageType ?? null,
    }));
  }

  async loadOrchestrationRuns(window: ReportingWindow): Promise<OrchestrationRunRow[]> {
    const rows = await getPrismaClient().orchestrationRequest.findMany({
      where: orchestrationCreatedWhere(window),
      select: {
        id: true,
        deliveryId: true,
        status: true,
        failureReason: true,
        startedAt: true,
        completedAt: true,
        attemptNumber: true,
      },
    });
    return rows;
  }

  async loadOrchestrationRunsForDeliveries(
    deliveryIds: string[],
  ): Promise<OrchestrationRunRow[]> {
    if (deliveryIds.length === 0) return [];
    const rows = await getPrismaClient().orchestrationRequest.findMany({
      where: { deliveryId: { in: deliveryIds } },
      select: {
        id: true,
        deliveryId: true,
        status: true,
        failureReason: true,
        startedAt: true,
        completedAt: true,
        attemptNumber: true,
      },
    });
    return rows;
  }

  async loadBookingsForDeliveries(deliveryIds: string[]): Promise<BookingRow[]> {
    if (deliveryIds.length === 0) return [];
    const rows = await getPrismaClient().providerBooking.findMany({
      where: { deliveryId: { in: deliveryIds } },
      select: { deliveryId: true, status: true, providerServiceCode: true },
    });
    return rows;
  }

  async loadBookingsForDeliveriesInWindow(
    window: ReportingWindow,
    deliveryIds: string[],
  ): Promise<BookingRow[]> {
    if (deliveryIds.length === 0) return [];
    const rows = await getPrismaClient().providerBooking.findMany({
      where: {
        deliveryId: { in: deliveryIds },
        createdAt: {
          gte: window.from,
          lt: window.toExclusive,
        },
      },
      select: { deliveryId: true, status: true, providerServiceCode: true },
    });
    return rows;
  }

  async loadEvaluationsForRequests(requestIds: string[]): Promise<EvaluationRow[]> {
    if (requestIds.length === 0) return [];
    const rows = await getPrismaClient().orchestrationEvaluation.findMany({
      where: { orchestrationRequestId: { in: requestIds } },
      select: {
        orchestrationRequestId: true,
        status: true,
        quoteAmount: true,
        providerServiceCode: true,
        selectedOption: { select: { id: true } },
        orchestrationRequest: { select: { deliveryId: true } },
      },
    });
    return rows.map((row) => ({
      orchestrationRequestId: row.orchestrationRequestId,
      deliveryId: row.orchestrationRequest.deliveryId,
      status: row.status,
      quoteAmount: row.quoteAmount == null ? null : Number(row.quoteAmount),
      providerServiceCode: row.providerServiceCode,
      selected: row.selectedOption != null,
    }));
  }

  async loadEvaluationsInRunWindow(window: ReportingWindow): Promise<EvaluationRow[]> {
    const rows = await getPrismaClient().orchestrationEvaluation.findMany({
      where: {
        orchestrationRequest: orchestrationCreatedWhere(window),
      },
      select: {
        orchestrationRequestId: true,
        status: true,
        quoteAmount: true,
        providerServiceCode: true,
        selectedOption: { select: { id: true } },
        orchestrationRequest: { select: { deliveryId: true } },
      },
    });
    return rows.map((row) => ({
      orchestrationRequestId: row.orchestrationRequestId,
      deliveryId: row.orchestrationRequest.deliveryId,
      status: row.status,
      quoteAmount: row.quoteAmount == null ? null : Number(row.quoteAmount),
      providerServiceCode: row.providerServiceCode,
      selected: row.selectedOption != null,
    }));
  }

  async loadRecentDeliveries(
    window: ReportingWindow,
    limit: number,
  ): Promise<
    Array<{
      id: string;
      reference: string;
      status: import("@prisma/client").DeliveryStatus;
      packageType: import("@prisma/client").PackageType | null;
      createdAt: Date;
      pickupLabel: string | null;
      dropLabel: string | null;
    }>
  > {
    const rows = await getPrismaClient().delivery.findMany({
      where: deliveryCreatedWhere(window),
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        reference: true,
        status: true,
        createdAt: true,
        package: { select: { packageType: true } },
        pickup: { select: { addressText: true } },
        drop: { select: { addressText: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      status: row.status,
      packageType: row.package?.packageType ?? null,
      createdAt: row.createdAt,
      pickupLabel: row.pickup?.addressText ?? null,
      dropLabel: row.drop?.addressText ?? null,
    }));
  }

  async loadRecentActivity(hours: number, limit: number) {
    const since = new Date(Date.now() - hours * 3_600_000);
    return getPrismaClient().deliveryStatusEvent.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        deliveryId: true,
        fromStatus: true,
        toStatus: true,
        createdAt: true,
        delivery: { select: { reference: true } },
      },
    });
  }

  async loadFeedbackAggregates(window: ReportingWindow) {
    const ratings = await getPrismaClient().deliveryRating.findMany({
      where: {
        createdAt: { gte: window.from, lt: window.toExclusive },
      },
      select: {
        driverRating: true,
        deliveryRating: true,
        deliveryId: true,
        createdAt: true,
        delivery: { select: { reference: true } },
      },
    });
    const feedbackRows = await getPrismaClient().deliveryFeedback.findMany({
      where: {
        createdAt: { gte: window.from, lt: window.toExclusive },
      },
      orderBy: { createdAt: "desc" },
      select: {
        issueTags: true,
        positiveTags: true,
        deliveryId: true,
        createdAt: true,
        delivery: { select: { reference: true } },
      },
    });
    return { ratings, feedbackRows };
  }
}

export const reportingRepository = new ReportingRepository();
