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
  OrchestrationOptionDto,
  OrchestrationRequestDto,
  ScoreBreakdown,
} from "./orchestration.types.js";

export type OrchestrationDbClient =
  | Prisma.TransactionClient
  | ReturnType<typeof getPrismaClient>;

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
    quoteAmount:
      row.quoteAmount == null ? null : Number(row.quoteAmount.toString()),
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
    availabilitySnapshot: row.availabilitySnapshot as Record<
      string,
      unknown
    > | null,
    etaSnapshot: row.etaSnapshot as Record<string, unknown> | null,
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
    },
    client?: OrchestrationDbClient,
  ): Promise<OrchestrationOptionDto>;
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
      },
    });
    return mapOption(row);
  }
}

export const orchestrationRepository = new PrismaOrchestrationRepository();
