import type {
  OrchestrationEvaluationDto,
  ProviderEvaluationOutcome,
} from "./orchestration.types.js";
import type { ScorableEvaluation, ScoredEvaluation } from "./orchestration.scoring.js";

/** Map each eligible outcome to a scorable row while preserving its index in `outcomes`. */
export function buildScorableEligibleEvaluations(
  outcomes: ProviderEvaluationOutcome[],
  resolveProviderPriority: (providerId: string) => number,
): ScorableEvaluation[] {
  let eligibleIndex = 0;
  const scorable: ScorableEvaluation[] = [];

  for (let outcomeIndex = 0; outcomeIndex < outcomes.length; outcomeIndex += 1) {
    const outcome = outcomes[outcomeIndex]!;
    if (outcome.status !== "ELIGIBLE" || outcome.signals.quote == null) {
      continue;
    }
    scorable.push({
      evaluationId: `temp-${eligibleIndex}`,
      outcomeIndex,
      providerId: outcome.signals.providerId,
      providerCode: outcome.signals.providerCode,
      providerPriority: resolveProviderPriority(outcome.signals.providerId),
      quote: outcome.signals.quote,
      availability: outcome.signals.availability,
      estimatedDeliveryAt: outcome.signals.quote.estimatedDeliveryAt
        ? new Date(outcome.signals.quote.estimatedDeliveryAt)
        : null,
      estimatedDeliveryMinutes: outcome.signals.quote.estimatedDeliveryMinutes ?? null,
    });
    eligibleIndex += 1;
  }

  return scorable;
}

export function resolveOutcomeIndexForWinner(
  winner: ScoredEvaluation,
  outcomes: ProviderEvaluationOutcome[],
): number {
  if (
    winner.outcomeIndex >= 0 &&
    winner.outcomeIndex < outcomes.length &&
    outcomes[winner.outcomeIndex]?.signals.providerId === winner.providerId
  ) {
    return winner.outcomeIndex;
  }

  const quoteId = winner.quote.providerQuoteId;
  const amount = winner.quote.amount?.amount;
  const fallback = outcomes.findIndex(
    (outcome) =>
      outcome.status === "ELIGIBLE" &&
      outcome.signals.providerId === winner.providerId &&
      outcome.signals.quote?.amount?.amount === amount &&
      (quoteId == null || outcome.signals.quote?.providerQuoteId === quoteId),
  );
  return fallback;
}

export function resolvePersistedEvaluationForWinner(
  persistedEvaluations: OrchestrationEvaluationDto[],
  winner: ScoredEvaluation,
  outcomes: ProviderEvaluationOutcome[],
): OrchestrationEvaluationDto | undefined {
  const outcomeIndex = resolveOutcomeIndexForWinner(winner, outcomes);
  if (outcomeIndex >= 0 && outcomeIndex < persistedEvaluations.length) {
    const byIndex = persistedEvaluations[outcomeIndex];
    if (byIndex?.providerId === winner.providerId) {
      return byIndex;
    }
  }

  const quoteId = winner.quote.providerQuoteId;
  const amount = winner.quote.amount?.amount;
  return persistedEvaluations.find(
    (evaluation) =>
      evaluation.providerId === winner.providerId &&
      evaluation.quoteAmount === amount &&
      (quoteId == null ||
        (evaluation.normalizedResult &&
          typeof evaluation.normalizedResult === "object" &&
          (evaluation.normalizedResult as { quote?: { providerQuoteId?: string } })
            .quote?.providerQuoteId === quoteId)),
  );
}

export function resolveWinningOutcome(
  winner: ScoredEvaluation,
  outcomes: ProviderEvaluationOutcome[],
): ProviderEvaluationOutcome | undefined {
  const index = resolveOutcomeIndexForWinner(winner, outcomes);
  return index >= 0 ? outcomes[index] : undefined;
}
