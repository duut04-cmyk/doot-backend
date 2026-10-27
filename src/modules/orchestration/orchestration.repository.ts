import type {
  OrchestrationEvaluationStatus,
  OrchestrationRequestStatus,
  Prisma,
} from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";
import { getPrismaClient } from "../../config/database.js";
import type {
  CreateOrchestrationEvaluationInput,
  OrchestrationEvaluationDto,
  OrchestrationListAggregate,
  OrchestrationListFilters,
  OrchestrationListLookup,
  OrchestrationOptionDto,
  OrchestrationRequestDto,
  ScoreBreakdown,
} from "./orchestration.types.js";

export type OrchestrationDbClient =
  Prisma.TransactionClient | ReturnType<typeof getPrismaClient>;

const requestInclude = {
  evaluations: { orderBy: { createdAt: "asc" as const } },
  selectedOption: true,
} as const;

function toDecimal(value: number | null): PrismaNamespace.Decimal | null {
  if (value == null) return null;
  return new PrismaNamespace.Decimal(value);
}

function mapEvaluation(row: {
  id: string;
  orchestrationRequestId: string;
  providerId: string;
  providerServiceId: string | null;
  providerCode: string;
  providerServiceCode: string | null;
  status: OrchestrationEvaluationStatus;
  serviceable: boolean | null;
  availabilityKnown: boolean | null;
  available: boolean | null;
  availableDriverCount: number | null;
  quoteAvailable: boolean | null;
  quoteAmount: PrismaNamespace.Decimal | null;
  quoteCurrency: string | null;
  estimatedDeliveryAt: Date | null;
  eligibilityReasons: unknown;
  exclusionReasons: unknown;
  warnings: unknown;
  score: PrismaNamespace.Decimal | null;
  scoreBreakdown: unknown;
  normalizedResult: unknown;
  providerMetadata: unknown;
  errorCategory: string | null;
  createdAt: Date;
}): OrchestrationEvaluationDto {
  return {
    id: row.id,
    orchestrationRequestId: row.orchestrationRequestId,
    providerId: row.providerId,
    providerServiceId: row.providerServiceId,
    providerCode: row.providerCode,
    providerServiceCode: row.providerServiceCode,
    status: row.status,
    serviceable: row.serviceable,
    availabilityKnown: row.availabilityKnown,
    available: row.available,
    availableDriverCount: row.availableDriverCount,
    quoteAvailable: row.quoteAvailable,
    quoteAmount: row.quoteAmount == null ? null : Number(row.quoteAmount.toString()),
    quoteCurrency: row.quoteCurrency,
    estimatedDeliveryAt: row.estimatedDeliveryAt,
    eligibilityReasons: row.eligibilityReasons as string[],
    exclusionReasons: row.exclusionReasons as string[],
    warnings: row.warnings as string[],
    score: row.score == null ? null : Number(row.score.toString()),
    scoreBreakdown: row.scoreBreakdown as ScoreBreakdown | null,
    normalizedResult: row.normalizedResult as Record<string, unknown> | null,
    providerMetadata: row.providerMetadata as Record<string, unknown> | null,
    errorCategory: row.errorCategory,
    createdAt: row.createdAt,
  };
}

function mapOption(row: {
  id: string;
  orchestrationRequestId: string;
  evaluationId: string;
  providerId: string;
  providerServiceId: string | null;
  providerCode: string;
  providerServiceCode: string | null;
  score: PrismaNamespace.Decimal;
  scoreBreakdown: unknown;
  selectionReason: string;
  quoteSnapshot: unknown;
  availabilitySnapshot: unknown;
  etaSnapshot: unknown;
  cancellationPolicySnapshot: unknown;
  createdAt: Date;
}): OrchestrationOptionDto {
  return {
    id: row.id,
    orchestrationRequestId: row.orchestrationRequestId,
    evaluationId: row.evaluationId,
    providerId: row.providerId,
    providerServiceId: row.providerServiceId,
    providerCode: row.providerCode,
    providerServiceCode: row.providerServiceCode,
    score: Number(row.score.toString()),
    scoreBreakdown: row.scoreBreakdown as ScoreBreakdown,
    selectionReason: row.selectionReason,
    quoteSnapshot: row.quoteSnapshot as Record<string, unknown>,
    availabilitySnapshot: row.availabilitySnapshot as Record<string, unknown> | null,
    etaSnapshot: row.etaSnapshot as Record<string, unknown> | null,
    cancellationPolicySnapshot:
      row.cancellationPolicySnapshot as OrchestrationOptionDto["cancellationPolicySnapshot"],
    createdAt: row.createdAt,
  };
}

function mapRequest(row: {
  id: string;
  deliveryId: string;
  requestedByUserId: string;
  attemptNumber: number;
  status: OrchestrationRequestStatus;
  failureReason: string | null;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  evaluations: Parameters<typeof mapEvaluation>[0][];
  selectedOption: Parameters<typeof mapOption>[0] | null;
}): OrchestrationRequestDto {
  return {
    id: row.id,
    deliveryId: row.deliveryId,
    requestedByUserId: row.requestedByUserId,
    attemptNumber: row.attemptNumber,
    status: row.status,
    failureReason: row.failureReason,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    evaluations: row.evaluations.map(mapEvaluation),
    selectedOption: row.selectedOption ? mapOption(row.selectedOption) : null,
  };
}

export interface IOrchestrationRepository {
  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
  getNextAttemptNumber(deliveryId: string): Promise<number>;
  findRunningByDeliveryId(deliveryId: string): Promise<OrchestrationRequestDto | null>;
  findLatestByDeliveryId(deliveryId: string): Promise<OrchestrationRequestDto | null>;
  findLatestCompletedByDeliveryId(
    deliveryId: string,
  ): Promise<OrchestrationRequestDto | null>;
  findSelectedOptionForDelivery(
    deliveryId: string,
  ): Promise<OrchestrationRequestDto | null>;
  findById(orchestrationRequestId: string): Promise<OrchestrationRequestDto | null>;
  createRequest(
    input: {
      deliveryId: string;
      requestedByUserId: string;
      attemptNumber: number;
    },
    client?: OrchestrationDbClient,
  ): Promise<OrchestrationRequestDto>;
  completeRequest(
    input: {
      requestId: string;
      status: Extract<OrchestrationRequestStatus, "COMPLETED" | "FAILED">;
      failureReason?: string | null;
    },
    client?: OrchestrationDbClient,
  ): Promise<void>;
  createEvaluations(
    evaluations: CreateOrchestrationEvaluationInput[],
    client?: OrchestrationDbClient,
  ): Promise<OrchestrationEvaluationDto[]>;
  createSelectedOption(
    input: {
      orchestrationRequestId: string;
      evaluationId: string;
      providerId: string;
      providerServiceId: string | null;
      providerCode: string;
      providerServiceCode: string | null;
      score: number;
      scoreBreakdown: ScoreBreakdown;
      selectionReason: string;
      quoteSnapshot: Record<string, unknown>;
      availabilitySnapshot: Record<string, unknown> | null;
      etaSnapshot: Record<string, unknown> | null;
      cancellationPolicySnapshot: Record<string, unknown> | null;
    },
    client?: OrchestrationDbClient,
  ): Promise<OrchestrationOptionDto>;
  listAdmin(
    page: number,
    limit: number,
    filters: OrchestrationListFilters,
    lookup: OrchestrationListLookup,
  ): Promise<{ items: OrchestrationListAggregate[]; total: number }>;
}

function matchesReference(reference: string, needle: string): boolean {
  return reference.toLowerCase().includes(needle.toLowerCase());
}

export function applyInMemoryOrchestrationListFilters(
  aggregate: OrchestrationListAggregate,
  filters: OrchestrationListFilters,
): boolean {
  const { request, delivery, booking } = aggregate;

  if (filters.from && request.createdAt < filters.from) {
    return false;
  }
  if (filters.to && request.createdAt > filters.to) {
    return false;
  }
  if (filters.deliveryId && request.deliveryId !== filters.deliveryId) {
    return false;
  }
  if (filters.orchestrationStatus && request.status !== filters.orchestrationStatus) {
    return false;
  }
  if (filters.reference) {
    if (!delivery || !matchesReference(delivery.reference, filters.reference)) {
      return false;
    }
  }
  if (filters.deliveryStatus) {
    if (!delivery || delivery.status !== filters.deliveryStatus) {
      return false;
    }
  }
  if (filters.bookingStatus) {
    if (!booking || booking.status !== filters.bookingStatus) {
      return false;
    }
  }
  return true;
}

function buildPrismaOrchestrationListWhere(
  filters: OrchestrationListFilters,
  bookingRequestIds?: string[],
): Prisma.OrchestrationRequestWhereInput {
  const where: Prisma.OrchestrationRequestWhereInput = {};

  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }
  if (filters.deliveryId) {
    where.deliveryId = filters.deliveryId;
  }
  if (filters.orchestrationStatus) {
    where.status = filters.orchestrationStatus;
  }
  const deliveryWhere: Prisma.DeliveryWhereInput = {};
  if (filters.reference) {
    deliveryWhere.reference = {
      contains: filters.reference,
      mode: "insensitive",
    };
  }
  if (filters.deliveryStatus) {
    deliveryWhere.status = filters.deliveryStatus;
  }
  if (Object.keys(deliveryWhere).length > 0) {
    where.delivery = deliveryWhere;
  }
  if (bookingRequestIds) {
    where.id = { in: bookingRequestIds };
  }
  return where;
}

export class PrismaOrchestrationRepository implements IOrchestrationRepository {
  private db(client?: OrchestrationDbClient) {
    return client ?? getPrismaClient();
  }

  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return getPrismaClient().$transaction(fn);
  }

  async getNextAttemptNumber(deliveryId: string): Promise<number> {
    const latest = await getPrismaClient().orchestrationRequest.findFirst({
      where: { deliveryId },
      orderBy: { attemptNumber: "desc" },
      select: { attemptNumber: true },
    });
    return (latest?.attemptNumber ?? 0) + 1;
  }

  async findRunningByDeliveryId(
    deliveryId: string,
  ): Promise<OrchestrationRequestDto | null> {
    const row = await getPrismaClient().orchestrationRequest.findFirst({
      where: { deliveryId, status: "RUNNING" },
      include: requestInclude,
    });
    return row ? mapRequest(row) : null;
  }

  async findLatestByDeliveryId(
    deliveryId: string,
  ): Promise<OrchestrationRequestDto | null> {
    const row = await getPrismaClient().orchestrationRequest.findFirst({
      where: { deliveryId },
      orderBy: { attemptNumber: "desc" },
      include: requestInclude,
    });
    return row ? mapRequest(row) : null;
  }

  async findLatestCompletedByDeliveryId(
    deliveryId: string,
  ): Promise<OrchestrationRequestDto | null> {
    const row = await getPrismaClient().orchestrationRequest.findFirst({
      where: { deliveryId, status: "COMPLETED" },
      orderBy: { attemptNumber: "desc" },
      include: requestInclude,
    });
    return row ? mapRequest(row) : null;
  }

  async findSelectedOptionForDelivery(
    deliveryId: string,
  ): Promise<OrchestrationRequestDto | null> {
    const request = await this.findLatestCompletedByDeliveryId(deliveryId);
    if (!request?.selectedOption) {
      return null;
    }
    return request;
  }

  async findById(
    orchestrationRequestId: string,
  ): Promise<OrchestrationRequestDto | null> {
    const row = await getPrismaClient().orchestrationRequest.findUnique({
      where: { id: orchestrationRequestId },
      include: requestInclude,
    });
    return row ? mapRequest(row) : null;
  }

  async createRequest(
    input: {
      deliveryId: string;
      requestedByUserId: string;
      attemptNumber: number;
    },
    client?: OrchestrationDbClient,
  ): Promise<OrchestrationRequestDto> {
    const row = await this.db(client).orchestrationRequest.create({
      data: {
        deliveryId: input.deliveryId,
        requestedByUserId: input.requestedByUserId,
        attemptNumber: input.attemptNumber,
        status: "RUNNING",
      },
      include: requestInclude,
    });
    return mapRequest(row);
  }

  async completeRequest(
    input: {
      requestId: string;
      status: Extract<OrchestrationRequestStatus, "COMPLETED" | "FAILED">;
      failureReason?: string | null;
    },
    client?: OrchestrationDbClient,
  ): Promise<void> {
    await this.db(client).orchestrationRequest.update({
      where: { id: input.requestId },
      data: {
        status: input.status,
        failureReason: input.failureReason ?? null,
        completedAt: new Date(),
      },
    });
  }

  async createEvaluations(
    evaluations: CreateOrchestrationEvaluationInput[],
    client?: OrchestrationDbClient,
  ): Promise<OrchestrationEvaluationDto[]> {
    const db = this.db(client);
    const created = await Promise.all(
      evaluations.map((evaluation) =>
        db.orchestrationEvaluation.create({
          data: {
            orchestrationRequestId: evaluation.orchestrationRequestId,
            providerId: evaluation.providerId,
            providerServiceId: evaluation.providerServiceId,
            providerCode: evaluation.providerCode,
            providerServiceCode: evaluation.providerServiceCode,
            status: evaluation.status,
            serviceable: evaluation.serviceable,
            availabilityKnown: evaluation.availabilityKnown,
            available: evaluation.available,
            availableDriverCount: evaluation.availableDriverCount,
            quoteAvailable: evaluation.quoteAvailable,
            quoteAmount: toDecimal(evaluation.quoteAmount),
            quoteCurrency: evaluation.quoteCurrency,
            estimatedDeliveryAt: evaluation.estimatedDeliveryAt,
            eligibilityReasons: evaluation.eligibilityReasons,
            exclusionReasons: evaluation.exclusionReasons,
            warnings: evaluation.warnings,
            score: toDecimal(evaluation.score),
            scoreBreakdown: evaluation.scoreBreakdown
              ? (evaluation.scoreBreakdown as unknown as Prisma.InputJsonValue)
              : undefined,
            normalizedResult: evaluation.normalizedResult
              ? (evaluation.normalizedResult as unknown as Prisma.InputJsonValue)
              : undefined,
            providerMetadata: evaluation.providerMetadata
              ? (evaluation.providerMetadata as unknown as Prisma.InputJsonValue)
              : undefined,
            errorCategory: evaluation.errorCategory,
          },
        }),
      ),
    );
    return created.map(mapEvaluation);
  }

  async createSelectedOption(
    input: {
      orchestrationRequestId: string;
      evaluationId: string;
      providerId: string;
      providerServiceId: string | null;
      providerCode: string;
      providerServiceCode: string | null;
      score: number;
      scoreBreakdown: ScoreBreakdown;
      selectionReason: string;
      quoteSnapshot: Record<string, unknown>;
      availabilitySnapshot: Record<string, unknown> | null;
      etaSnapshot: Record<string, unknown> | null;
      cancellationPolicySnapshot: Record<string, unknown> | null;
    },
    client?: OrchestrationDbClient,
  ): Promise<OrchestrationOptionDto> {
    const row = await this.db(client).orchestrationOption.create({
      data: {
        orchestrationRequestId: input.orchestrationRequestId,
        evaluationId: input.evaluationId,
        providerId: input.providerId,
        providerServiceId: input.providerServiceId,
        providerCode: input.providerCode,
        providerServiceCode: input.providerServiceCode,
        score: toDecimal(input.score) ?? new PrismaNamespace.Decimal(0),
        scoreBreakdown: input.scoreBreakdown as unknown as Prisma.InputJsonValue,
        selectionReason: input.selectionReason,
        quoteSnapshot: input.quoteSnapshot as unknown as Prisma.InputJsonValue,
        availabilitySnapshot: input.availabilitySnapshot
          ? (input.availabilitySnapshot as unknown as Prisma.InputJsonValue)
          : undefined,
        etaSnapshot: input.etaSnapshot
          ? (input.etaSnapshot as unknown as Prisma.InputJsonValue)
          : undefined,
        cancellationPolicySnapshot: input.cancellationPolicySnapshot
          ? (input.cancellationPolicySnapshot as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });
    return mapOption(row);
  }

  async listAdmin(
    page: number,
    limit: number,
    filters: OrchestrationListFilters,
    lookup: OrchestrationListLookup,
  ): Promise<{ items: OrchestrationListAggregate[]; total: number }> {
    void lookup;
    let bookingRequestIds: string[] | undefined;
    if (filters.bookingStatus) {
      const rows = await getPrismaClient().providerBooking.findMany({
        where: { status: filters.bookingStatus },
        select: { orchestrationRequestId: true },
      });
      bookingRequestIds = rows.map((row) => row.orchestrationRequestId);
      if (bookingRequestIds.length === 0) {
        return { items: [], total: 0 };
      }
    }

    const where = buildPrismaOrchestrationListWhere(filters, bookingRequestIds);
    const [total, rows] = await Promise.all([
      getPrismaClient().orchestrationRequest.count({ where }),
      getPrismaClient().orchestrationRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          delivery: { include: { pickup: true, drop: true } },
          selectedOption: true,
          evaluations: { orderBy: { createdAt: "asc" } },
        },
      }),
    ]);

    const requestIds = rows.map((row) => row.id);
    const bookings =
      requestIds.length === 0
        ? []
        : await getPrismaClient().providerBooking.findMany({
            where: { orchestrationRequestId: { in: requestIds } },
          });
    const bookingByRequestId = new Map(
      bookings.map((booking) => [booking.orchestrationRequestId, booking]),
    );

    const items: OrchestrationListAggregate[] = rows.map((row) => {
      const request = mapRequest(row);
      const deliveryRow = row.delivery;
      const bookingRow = bookingByRequestId.get(row.id);
      return {
        request,
        delivery: deliveryRow
          ? {
              id: deliveryRow.id,
              reference: deliveryRow.reference,
              status: deliveryRow.status,
              pickupAddressText: deliveryRow.pickup?.addressText ?? "",
              dropAddressText: deliveryRow.drop?.addressText ?? "",
            }
          : null,
        booking: bookingRow
          ? {
              status: bookingRow.status,
              providerReference: bookingRow.providerReference,
              providerOrderId: bookingRow.providerOrderId,
            }
          : null,
      };
    });

    return { items, total };
  }
}

export const orchestrationRepository = new PrismaOrchestrationRepository();
