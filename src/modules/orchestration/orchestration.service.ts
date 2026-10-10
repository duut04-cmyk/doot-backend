import type { UserRole } from "@prisma/client";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import {
  deliveryRepository,
  toDeliveryDetailDto,
  type IDeliveryRepository,
} from "../delivery/delivery.repository.js";
import {
  providerRepository,
  type IProviderRepository,
} from "../provider/provider.repository.js";
import type { AdapterExecutionContext } from "../provider/adapters/provider-adapter.types.js";
import {
  ORCHESTRATION_BLOCKED_STATUSES,
  ORCHESTRATION_RETRYABLE_STATUSES,
} from "./orchestration.constants.js";
import {
  isProviderOrchestrationCandidate,
  resolvePrimaryService,
} from "./orchestration.eligibility.js";
import { mapOrchestrationResponse } from "./orchestration.mapper.js";
import {
  OrchestrationProviderEvaluationService,
  orchestrationProviderEvaluationService,
} from "./orchestration.provider-evaluation.js";
import {
  orchestrationRepository,
  type IOrchestrationRepository,
} from "./orchestration.repository.js";
import { enrichQuoteSnapshotWithCustomerPricing } from "../pricing/customer-delivery-pricing.js";
import {
  buildSelectionReason,
  compareScoredEvaluations,
  scoreEligibleEvaluations,
  type ScorableEvaluation,
} from "./orchestration.scoring.js";
import { toCancellationPolicySnapshot } from "../provider/contracts/cancellation-policy.js";
import type { ProviderWithRelations } from "../provider/provider.repository.js";
import type {
  CreateOrchestrationEvaluationInput,
  OrchestrationRequestDto,
  ProviderEvaluationOutcome,
} from "./orchestration.types.js";

const orchestrationProviderDeadlineMarker = Symbol("orchestrationProviderDeadline");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class OrchestrationService {
  constructor(
    private readonly deliveryRepo: IDeliveryRepository = deliveryRepository,
    private readonly providerRepo: IProviderRepository = providerRepository,
    private readonly orchestrationRepo: IOrchestrationRepository = orchestrationRepository,
    private readonly providerEvaluation: OrchestrationProviderEvaluationService = orchestrationProviderEvaluationService,
    private readonly orchestrationMaxDurationMs: number = env.ORCHESTRATION_MAX_DURATION_MS ??
      15_000,
  ) {}

  async orchestrate(input: {
    deliveryId: string;
    userId: string;
    role: UserRole;
    requestId: string;
    testHints?: AdapterExecutionContext["testHints"];
  }) {
    const deliveryRecord = await this.loadAuthorizedDelivery(
      input.deliveryId,
      input.userId,
      input.role,
    );
    const delivery = toDeliveryDetailDto(deliveryRecord);

    if (delivery.status === "OPTION_READY") {
      const existing = await this.resolveBookableOrchestrationRequest(input.deliveryId);
      return {
        success: true as const,
        data: mapOrchestrationResponse(
          input.role,
          delivery.id,
          delivery.status,
          existing,
        ),
      };
    }

    if (delivery.status === "ORCHESTRATING") {
      const running = await this.orchestrationRepo.findRunningByDeliveryId(
        input.deliveryId,
      );
      if (running) {
        throw new AppError("Orchestration is already in progress.", {
          statusCode: 409,
          code: ErrorCodes.ORCHESTRATION_IN_PROGRESS,
        });
      }
      throw new AppError("Delivery is orchestrating but no active request exists.", {
        statusCode: 409,
        code: ErrorCodes.ORCHESTRATION_IN_PROGRESS,
      });
    }

    if (ORCHESTRATION_BLOCKED_STATUSES.includes(delivery.status)) {
      throw new AppError("Delivery is not ready for orchestration.", {
        statusCode: 422,
        code: ErrorCodes.DELIVERY_NOT_READY_FOR_ORCHESTRATION,
      });
    }

    if (!ORCHESTRATION_RETRYABLE_STATUSES.includes(delivery.status)) {
      throw new AppError("Delivery is not ready for orchestration.", {
        statusCode: 422,
        code: ErrorCodes.DELIVERY_NOT_READY_FOR_ORCHESTRATION,
      });
    }

    const attemptNumber = await this.orchestrationRepo.getNextAttemptNumber(
      input.deliveryId,
    );

    const request = await this.deliveryRepo.withTransaction(async (tx) => {
      const transitioned = await this.deliveryRepo.transitionStatus(
        {
          deliveryId: input.deliveryId,
          expectedFromStatuses: ["CREATED", "FAILED"],
          toStatus: "ORCHESTRATING",
          source: "ORCHESTRATION",
          reason: "Orchestration started",
          metadata: { attemptNumber },
        },
        tx,
      );
      if (!transitioned) {
        throw new AppError("Delivery state changed before orchestration could start.", {
          statusCode: 409,
          code: ErrorCodes.ORCHESTRATION_IN_PROGRESS,
        });
      }
      return this.orchestrationRepo.createRequest(
        {
          deliveryId: input.deliveryId,
          requestedByUserId: input.userId,
          attemptNumber,
        },
        tx,
      );
    });

    try {
      const finalized = await this.runOrchestration({
        deliveryId: input.deliveryId,
        delivery,
        request,
        requestId: input.requestId,
        testHints: input.testHints,
      });
      return {
        success: true as const,
        data: mapOrchestrationResponse(
          input.role,
          delivery.id,
          finalized.deliveryStatus,
          finalized.request,
        ),
      };
    } catch (error) {
      await this.failOrchestrationSafely(request.id, input.deliveryId);
      throw error;
    }
  }

  async getLatestOrchestration(input: {
    deliveryId: string;
    userId: string;
    role: UserRole;
  }) {
    const deliveryRecord = await this.loadAuthorizedDelivery(
      input.deliveryId,
      input.userId,
      input.role,
    );
    const delivery = toDeliveryDetailDto(deliveryRecord);
    const request = await this.resolveOrchestrationRequestForRead(
      input.deliveryId,
      delivery.status,
    );
    return {
      success: true as const,
      data: mapOrchestrationResponse(
        input.role,
        deliveryRecord.id,
        delivery.status,
        request,
      ),
    };
  }

  /** Latest COMPLETED orchestration that includes a selected provider option. */
  private async resolveBookableOrchestrationRequest(deliveryId: string) {
    const completed =
      await this.orchestrationRepo.findLatestCompletedByDeliveryId(deliveryId);
    if (!completed?.selectedOption) {
      throw new AppError("Orchestration result not found.", {
        statusCode: 404,
        code: ErrorCodes.ORCHESTRATION_NOT_FOUND,
      });
    }
    return completed;
  }

  /**
   * Avoid mixing delivery OPTION_READY with a newer RUNNING attempt (empty selectedOption).
   */
  private async resolveOrchestrationRequestForRead(
    deliveryId: string,
    deliveryStatus: string,
  ) {
    if (deliveryStatus === "OPTION_READY") {
      return this.resolveBookableOrchestrationRequest(deliveryId);
    }

    const running = await this.orchestrationRepo.findRunningByDeliveryId(deliveryId);
    if (running) {
      return running;
    }

    const latest = await this.orchestrationRepo.findLatestByDeliveryId(deliveryId);
    if (!latest) {
      throw new AppError("Orchestration result not found.", {
        statusCode: 404,
        code: ErrorCodes.ORCHESTRATION_NOT_FOUND,
      });
    }
    return latest;
  }

  private async runOrchestration(input: {
    deliveryId: string;
    delivery: ReturnType<typeof toDeliveryDetailDto>;
    request: OrchestrationRequestDto;
    requestId: string;
    testHints?: AdapterExecutionContext["testHints"];
  }) {
    let providers = (await this.providerRepo.listProviders())
      .filter(isProviderOrchestrationCandidate)
      .sort((a, b) => a.priority - b.priority);

    if (env.ORCHESTRATION_MOCK_ONLY && env.NODE_ENV !== "production") {
      const mockOnly = providers.filter((provider) => provider.code === "MOCK");
      if (mockOnly.length > 0) {
        providers = mockOnly;
      }
    }

    const orchestrationDeadlineAt = Date.now() + this.orchestrationMaxDurationMs;

    const settled = await Promise.allSettled(
      providers.map((provider) =>
        this.evaluateProviderWithinOrchestrationBudget({
          provider,
          delivery: input.delivery,
          requestId: input.requestId,
          testHints: input.testHints,
          deadlineAt: orchestrationDeadlineAt,
        }),
      ),
    );

    const outcomes: ProviderEvaluationOutcome[] = settled.map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      const provider = providers[index];
      return {
        status: "ERROR" as const,
        signals: {
          providerId: provider?.id ?? "unknown",
          providerCode: provider?.code ?? "UNKNOWN",
          providerServiceId: null,
          providerServiceCode: null,
          serviceability: null,
          availability: null,
          quote: null,
          cancellationPolicy: null,
          compatibility: {
            weightCompatible: true,
            dimensionsCompatible: true,
            requirementsCompatible: true,
            scheduleCompatible: true,
          },
          warnings: [],
          providerMetadata: {},
        },
        exclusionReasons: [],
        eligibilityReasons: [],
        errorCategory: ErrorCodes.PROVIDER_ADAPTER_ERROR,
        score: null,
        scoreBreakdown: null,
      };
    });

    const evaluationInputs = outcomes.map((outcome) =>
      this.toEvaluationInput(input.request.id, outcome),
    );

    const eligible = outcomes.filter((outcome) => outcome.status === "ELIGIBLE");
    const scorable: ScorableEvaluation[] = eligible
      .filter(
        (outcome): outcome is ProviderEvaluationOutcome & { status: "ELIGIBLE" } =>
          outcome.signals.quote != null,
      )
      .map((outcome, index) => ({
        evaluationId: `temp-${index}`,
        providerId: outcome.signals.providerId,
        providerCode: outcome.signals.providerCode,
        providerPriority:
          providers.find((provider) => provider.id === outcome.signals.providerId)
            ?.priority ?? 100,
        quote: outcome.signals.quote!,
        availability: outcome.signals.availability,
        estimatedDeliveryAt: outcome.signals.quote?.estimatedDeliveryAt
          ? new Date(outcome.signals.quote.estimatedDeliveryAt)
          : null,
        estimatedDeliveryMinutes:
          outcome.signals.quote?.estimatedDeliveryMinutes ?? null,
      }));

    const scored = scoreEligibleEvaluations(scorable).sort(compareScoredEvaluations);
    const winner = scored[0] ?? null;

    for (const evaluation of evaluationInputs) {
      const scoredMatch = winner
        ? scored.find((item) => item.providerId === evaluation.providerId)
        : null;
      if (scoredMatch) {
        evaluation.score = scoredMatch.score;
        evaluation.scoreBreakdown = scoredMatch.scoreBreakdown;
        if (evaluation.status === "ELIGIBLE") {
          evaluation.status = "ELIGIBLE";
        }
      }
    }

    return this.deliveryRepo.withTransaction(async (tx) => {
      const persistedEvaluations = await this.orchestrationRepo.createEvaluations(
        evaluationInputs,
        tx,
      );

      let selectedOption = null;
      if (winner) {
        const winnerEvaluation = persistedEvaluations.find(
          (evaluation) => evaluation.providerId === winner.providerId,
        );
        if (winnerEvaluation && winnerEvaluation.quoteAmount != null) {
          const selectionReason = buildSelectionReason(winner);
          selectedOption = await this.orchestrationRepo.createSelectedOption(
            {
              orchestrationRequestId: input.request.id,
              evaluationId: winnerEvaluation.id,
              providerId: winnerEvaluation.providerId,
              providerServiceId: winnerEvaluation.providerServiceId,
              providerCode: winnerEvaluation.providerCode,
              providerServiceCode: winnerEvaluation.providerServiceCode,
              score: winner.score,
              scoreBreakdown: winner.scoreBreakdown,
              selectionReason,
              quoteSnapshot: enrichQuoteSnapshotWithCustomerPricing({
                amount: winnerEvaluation.quoteAmount,
                currency: winnerEvaluation.quoteCurrency ?? "INR",
                providerQuoteId: winner.quote.providerQuoteId ?? null,
              }),
              availabilitySnapshot:
                winnerEvaluation.availabilityKnown == null
                  ? null
                  : {
                      known: winnerEvaluation.availabilityKnown,
                      available: winnerEvaluation.available,
                      availableDriverCount: winnerEvaluation.availableDriverCount,
                    },
              etaSnapshot: winnerEvaluation.estimatedDeliveryAt
                ? {
                    estimatedDeliveryAt:
                      winnerEvaluation.estimatedDeliveryAt.toISOString(),
                  }
                : winner.quote.estimatedDeliveryMinutes != null
                  ? {
                      estimatedDeliveryMinutes: winner.quote.estimatedDeliveryMinutes,
                    }
                  : null,
              cancellationPolicySnapshot: (() => {
                const winnerOutcome = outcomes.find(
                  (item) => item.signals.providerId === winner.providerId,
                );
                const policy = winnerOutcome?.signals.cancellationPolicy;
                return policy ? toCancellationPolicySnapshot(policy) : null;
              })(),
            },
            tx,
          );
        }
      }

      const hasEligibleProvider = Boolean(selectedOption);
      const deliveryStatus = hasEligibleProvider ? "OPTION_READY" : "FAILED";
      const requestStatus = hasEligibleProvider ? "COMPLETED" : "FAILED";
      const failureReason = hasEligibleProvider
        ? null
        : "No eligible provider options were found.";

      await this.orchestrationRepo.completeRequest(
        {
          requestId: input.request.id,
          status: requestStatus,
          failureReason,
        },
        tx,
      );

      const transitioned = await this.deliveryRepo.transitionStatus(
        {
          deliveryId: input.deliveryId,
          expectedFromStatuses: ["ORCHESTRATING"],
          toStatus: deliveryStatus,
          source: "ORCHESTRATION",
          reason: hasEligibleProvider
            ? "Orchestration completed with selected option"
            : "Orchestration failed — no eligible providers",
          metadata: {
            orchestrationRequestId: input.request.id,
            selectedProviderCode: selectedOption?.providerCode ?? null,
          },
        },
        tx,
      );

      if (!transitioned) {
        throw new AppError("Failed to finalize delivery orchestration state.", {
          statusCode: 500,
          code: ErrorCodes.ORCHESTRATION_FAILED,
        });
      }

      logger.info(
        {
          requestId: input.requestId,
          deliveryId: input.deliveryId,
          orchestrationRequestId: input.request.id,
          providerCount: providers.length,
          eligibleCount: eligible.length,
          selectedProviderCode: selectedOption?.providerCode ?? null,
          selectedCancellationPolicyKnown:
            selectedOption?.cancellationPolicySnapshot?.policyKnown ?? null,
          deliveryStatus,
        },
        "orchestration_completed",
      );

      const refreshed = await this.orchestrationRepo.findLatestByDeliveryId(
        input.deliveryId,
      );
      if (!refreshed) {
        throw new AppError("Orchestration result not found after completion.", {
          statusCode: 500,
          code: ErrorCodes.ORCHESTRATION_FAILED,
        });
      }

      return {
        deliveryStatus,
        request: refreshed,
      };
    });
  }

  private async evaluateProviderWithinOrchestrationBudget(input: {
    provider: ProviderWithRelations;
    delivery: ReturnType<typeof toDeliveryDetailDto>;
    requestId: string;
    testHints?: AdapterExecutionContext["testHints"];
    deadlineAt: number;
  }): Promise<ProviderEvaluationOutcome> {
    const remainingMs = input.deadlineAt - Date.now();
    if (remainingMs <= 0) {
      return this.buildOrchestrationTimeoutOutcome(input.provider);
    }

    const evaluationPromise = this.providerEvaluation.evaluateProvider({
      provider: input.provider,
      delivery: input.delivery,
      requestId: input.requestId,
      testHints: input.testHints,
    });

    const raced = await Promise.race([
      evaluationPromise,
      sleep(remainingMs).then(() => orchestrationProviderDeadlineMarker),
    ]);

    if (raced === orchestrationProviderDeadlineMarker) {
      return this.buildOrchestrationTimeoutOutcome(input.provider);
    }

    return raced as ProviderEvaluationOutcome;
  }

  private buildOrchestrationTimeoutOutcome(
    provider: ProviderWithRelations,
  ): ProviderEvaluationOutcome {
    const { serviceId, serviceCode } = resolvePrimaryService(provider);
    return {
      status: "ERROR",
      signals: {
        providerId: provider.id,
        providerCode: provider.code,
        providerServiceId: serviceId,
        providerServiceCode: serviceCode,
        serviceability: null,
        availability: null,
        quote: null,
        cancellationPolicy: null,
        compatibility: {
          weightCompatible: true,
          dimensionsCompatible: true,
          requirementsCompatible: true,
          scheduleCompatible: true,
        },
        warnings: [],
        providerMetadata: {},
      },
      exclusionReasons: [],
      eligibilityReasons: [],
      errorCategory: "PROVIDER_TIMEOUT",
      score: null,
      scoreBreakdown: null,
    };
  }

  private toEvaluationInput(
    orchestrationRequestId: string,
    outcome: ProviderEvaluationOutcome,
  ): CreateOrchestrationEvaluationInput {
    const { signals } = outcome;
    const quote = signals.quote;
    const availability = signals.availability;
    return {
      orchestrationRequestId,
      providerId: signals.providerId,
      providerServiceId: signals.providerServiceId,
      providerCode: signals.providerCode,
      providerServiceCode: signals.providerServiceCode,
      status: outcome.status,
      serviceable: signals.serviceability?.serviceable ?? null,
      availabilityKnown: availability?.known ?? null,
      available: availability?.known ? availability.available : null,
      availableDriverCount: availability?.known
        ? availability.availableDriverCount
        : null,
      quoteAvailable: quote?.available ?? null,
      quoteAmount: quote?.amount?.amount ?? null,
      quoteCurrency: quote?.amount?.currency ?? null,
      estimatedDeliveryAt: quote?.estimatedDeliveryAt
        ? new Date(quote.estimatedDeliveryAt)
        : null,
      eligibilityReasons: outcome.eligibilityReasons,
      exclusionReasons: outcome.exclusionReasons,
      warnings: signals.warnings,
      score: outcome.score,
      scoreBreakdown: outcome.scoreBreakdown,
      normalizedResult: {
        serviceability: signals.serviceability,
        availability: signals.availability,
        quote: signals.quote,
        compatibility: signals.compatibility,
        cancellationPolicy: signals.cancellationPolicy,
      },
      providerMetadata: signals.providerMetadata,
      errorCategory: outcome.errorCategory,
    };
  }

  private async loadAuthorizedDelivery(
    deliveryId: string,
    userId: string,
    role: UserRole,
  ) {
    const delivery =
      role === "ADMIN"
        ? await this.deliveryRepo.findById(deliveryId)
        : await this.deliveryRepo.findByIdForCustomer(deliveryId, userId);
    if (!delivery) {
      throw new AppError("Delivery not found.", {
        statusCode: 404,
        code: ErrorCodes.DELIVERY_NOT_FOUND,
      });
    }
    return delivery;
  }

  private async failOrchestrationSafely(
    requestId: string,
    deliveryId: string,
  ): Promise<void> {
    try {
      await this.deliveryRepo.withTransaction(async (tx) => {
        await this.orchestrationRepo.completeRequest(
          {
            requestId,
            status: "FAILED",
            failureReason: "Orchestration failed due to an internal error.",
          },
          tx,
        );
        await this.deliveryRepo.transitionStatus(
          {
            deliveryId,
            expectedFromStatuses: ["ORCHESTRATING"],
            toStatus: "FAILED",
            source: "ORCHESTRATION",
            reason: "Orchestration failed due to an internal error.",
          },
          tx,
        );
      });
    } catch {
      // Best-effort cleanup only.
    }
  }
}

export const orchestrationService = new OrchestrationService();
