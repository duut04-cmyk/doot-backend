import { randomUUID } from "node:crypto";
import type { OrchestrationRequestStatus, Prisma } from "@prisma/client";
import type {
  CreateOrchestrationEvaluationInput,
  OrchestrationEvaluationDto,
  OrchestrationOptionDto,
  OrchestrationRequestDto,
  ScoreBreakdown,
} from "../../src/modules/orchestration/orchestration.types.js";
import type { IOrchestrationRepository } from "../../src/modules/orchestration/orchestration.repository.js";

export class InMemoryOrchestrationRepository implements IOrchestrationRepository {
  requests: OrchestrationRequestDto[] = [];
  evaluations: OrchestrationEvaluationDto[] = [];
  options: OrchestrationOptionDto[] = [];

  async withTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const snapRequests = structuredClone(this.requests);
    const snapEvaluations = structuredClone(this.evaluations);
    const snapOptions = structuredClone(this.options);
    try {
      return await fn({} as Prisma.TransactionClient);
    } catch (error) {
      this.requests = snapRequests;
      this.evaluations = snapEvaluations;
      this.options = snapOptions;
      throw error;
    }
  }

  async getNextAttemptNumber(deliveryId: string): Promise<number> {
    const latest = this.requests
      .filter((request) => request.deliveryId === deliveryId)
      .sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
    return (latest?.attemptNumber ?? 0) + 1;
  }

  async findRunningByDeliveryId(
    deliveryId: string,
  ): Promise<OrchestrationRequestDto | null> {
    const request = this.requests.find(
      (item) => item.deliveryId === deliveryId && item.status === "RUNNING",
    );
    return request ? this.hydrateRequest(request.id) : null;
  }

  async findLatestByDeliveryId(
    deliveryId: string,
  ): Promise<OrchestrationRequestDto | null> {
    const request = this.requests
      .filter((item) => item.deliveryId === deliveryId)
      .sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
    return request ? this.hydrateRequest(request.id) : null;
  }

  async findLatestCompletedByDeliveryId(
    deliveryId: string,
  ): Promise<OrchestrationRequestDto | null> {
    const request = this.requests
      .filter(
        (item) => item.deliveryId === deliveryId && item.status === "COMPLETED",
      )
      .sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
    return request ? this.hydrateRequest(request.id) : null;
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
  ): Promise<OrchestrationRequestDto> {
    const running = await this.findRunningByDeliveryId(input.deliveryId);
    if (running) {
      throw new Error("Orchestration already running for delivery.");
    }

    const now = new Date();
    const request: OrchestrationRequestDto = {
      id: randomUUID(),
      deliveryId: input.deliveryId,
      requestedByUserId: input.requestedByUserId,
      attemptNumber: input.attemptNumber,
      status: "RUNNING",
      failureReason: null,
      startedAt: now,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      evaluations: [],
      selectedOption: null,
    };
    this.requests.push(request);
    return request;
  }

  async completeRequest(input: {
    requestId: string;
    status: Extract<OrchestrationRequestStatus, "COMPLETED" | "FAILED">;
    failureReason?: string | null;
  }): Promise<void> {
    const request = this.requests.find((item) => item.id === input.requestId);
    if (!request) {
      throw new Error("Orchestration request not found.");
    }
    request.status = input.status;
    request.failureReason = input.failureReason ?? null;
    request.completedAt = new Date();
    request.updatedAt = new Date();
  }

  async createEvaluations(
    evaluations: CreateOrchestrationEvaluationInput[],
  ): Promise<OrchestrationEvaluationDto[]> {
    const created = evaluations.map((evaluation) => {
      const row: OrchestrationEvaluationDto = {
        id: randomUUID(),
        ...evaluation,
        createdAt: new Date(),
      };
      this.evaluations.push(row);
      return row;
    });
    return created;
  }

  async createSelectedOption(input: {
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
  }): Promise<OrchestrationOptionDto> {
    const option: OrchestrationOptionDto = {
      id: randomUUID(),
      orchestrationRequestId: input.orchestrationRequestId,
      evaluationId: input.evaluationId,
      providerId: input.providerId,
      providerServiceId: input.providerServiceId,
      providerCode: input.providerCode,
      providerServiceCode: input.providerServiceCode,
      score: input.score,
      scoreBreakdown: input.scoreBreakdown,
      selectionReason: input.selectionReason,
      quoteSnapshot: input.quoteSnapshot,
      availabilitySnapshot: input.availabilitySnapshot,
      etaSnapshot: input.etaSnapshot,
      cancellationPolicySnapshot:
        input.cancellationPolicySnapshot as OrchestrationOptionDto["cancellationPolicySnapshot"],
      createdAt: new Date(),
    };
    this.options.push(option);
    return option;
  }

  private hydrateRequest(requestId: string): OrchestrationRequestDto | null {
    const request = this.requests.find((item) => item.id === requestId);
    if (!request) {
      return null;
    }
    const evaluations = this.evaluations.filter(
      (item) => item.orchestrationRequestId === requestId,
    );
    const selectedOption =
      this.options.find((item) => item.orchestrationRequestId === requestId) ??
      null;
    return {
      ...request,
      evaluations,
      selectedOption,
    };
  }
}
