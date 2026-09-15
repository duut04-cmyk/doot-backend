import type { AvailabilityResult } from "../provider/contracts/availability.js";
import type { NormalizedQuote } from "../provider/contracts/quote.js";
import { SCORE_WEIGHTS } from "./orchestration.constants.js";
import type { ScoreBreakdown } from "./orchestration.types.js";

export type ScorableEvaluation = {
  evaluationId: string;
  providerId: string;
  providerCode: string;
  providerPriority: number;
  quote: NormalizedQuote;
  availability: AvailabilityResult | null;
  estimatedDeliveryAt: Date | null;
  estimatedDeliveryMinutes: number | null;
};

export type ScoredEvaluation = ScorableEvaluation & {
  score: number;
  scoreBreakdown: ScoreBreakdown;
};

function relativeInverseScore(
  value: number,
  min: number,
  max: number,
): number {
  if (max === min) {
    return 100;
  }
  const normalized = (value - min) / (max - min);
  return Math.max(0, Math.min(100, (1 - normalized) * 100));
}

function computePriceScores(
  evaluations: ScorableEvaluation[],
): Map<string, number> {
  const prices = evaluations
    .map((item) => item.quote.amount?.amount)
    .filter((value): value is number => typeof value === "number");
  const scores = new Map<string, number>();
  if (prices.length === 0) {
    return scores;
  }
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  for (const evaluation of evaluations) {
    const amount = evaluation.quote.amount?.amount;
    if (typeof amount !== "number") {
      continue;
    }
    scores.set(evaluation.evaluationId, relativeInverseScore(amount, min, max));
  }
  return scores;
}

function computeEtaScores(
  evaluations: ScorableEvaluation[],
): Map<string, number> {
  const etaMinutes = evaluations.map((item) => {
    if (item.estimatedDeliveryMinutes != null) {
      return item.estimatedDeliveryMinutes;
    }
    if (item.estimatedDeliveryAt) {
      return Math.max(
        0,
        (item.estimatedDeliveryAt.getTime() - Date.now()) / 60_000,
      );
    }
    return null;
  });

  const valid = etaMinutes.filter((value): value is number => value != null);
  const scores = new Map<string, number>();
  if (valid.length === 0) {
    return scores;
  }
  const min = Math.min(...valid);
  const max = Math.max(...valid);

  evaluations.forEach((evaluation, index) => {
    const minutes = etaMinutes[index];
    if (minutes == null) {
      return;
    }
    scores.set(
      evaluation.evaluationId,
      relativeInverseScore(minutes, min, max),
    );
  });
  return scores;
}

function computeAvailabilityScores(
  evaluations: ScorableEvaluation[],
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const evaluation of evaluations) {
    const availability = evaluation.availability;
    if (!availability?.known) {
      continue;
    }
    if (!availability.available) {
      scores.set(evaluation.evaluationId, 0);
      continue;
    }
    if (availability.availableDriverCount != null) {
      const count = availability.availableDriverCount;
      scores.set(
        evaluation.evaluationId,
        Math.max(0, Math.min(100, Math.min(count, 10) * 10)),
      );
    } else {
      scores.set(evaluation.evaluationId, 80);
    }
  }
  return scores;
}

function computePriorityScores(
  evaluations: ScorableEvaluation[],
): Map<string, number> {
  const scores = new Map<string, number>();
  const priorities = evaluations.map((item) => item.providerPriority);
  const min = Math.min(...priorities);
  const max = Math.max(...priorities);
  for (const evaluation of evaluations) {
    scores.set(
      evaluation.evaluationId,
      relativeInverseScore(evaluation.providerPriority, min, max),
    );
  }
  return scores;
}

export function scoreEligibleEvaluations(
  evaluations: ScorableEvaluation[],
): ScoredEvaluation[] {
  if (evaluations.length === 0) {
    return [];
  }

  const priceScores = computePriceScores(evaluations);
  const etaScores = computeEtaScores(evaluations);
  const availabilityScores = computeAvailabilityScores(evaluations);
  const priorityScores = computePriorityScores(evaluations);

  return evaluations.map((evaluation) => {
    const factors: Array<{
      key: keyof typeof SCORE_WEIGHTS;
      weight: number;
      score: number | null;
    }> = [
      {
        key: "PRICE",
        weight: SCORE_WEIGHTS.PRICE,
        score: priceScores.get(evaluation.evaluationId) ?? null,
      },
      {
        key: "ETA",
        weight: SCORE_WEIGHTS.ETA,
        score: etaScores.get(evaluation.evaluationId) ?? null,
      },
      {
        key: "AVAILABILITY",
        weight: SCORE_WEIGHTS.AVAILABILITY,
        score: availabilityScores.get(evaluation.evaluationId) ?? null,
      },
      {
        key: "PROVIDER_PRIORITY",
        weight: SCORE_WEIGHTS.PROVIDER_PRIORITY,
        score: priorityScores.get(evaluation.evaluationId) ?? null,
      },
      {
        key: "SERVICE_QUALITY",
        weight: SCORE_WEIGHTS.SERVICE_QUALITY,
        score: null,
      },
    ];

    const applicable = factors.filter((factor) => factor.score != null);
    const applicableWeightSum = applicable.reduce(
      (sum, factor) => sum + factor.weight,
      0,
    );
    const rawWeightedScore =
      applicableWeightSum === 0
        ? 0
        : applicable.reduce(
            (sum, factor) => sum + factor.weight * (factor.score ?? 0),
            0,
          );
    const score =
      applicableWeightSum === 0
        ? 0
        : Math.max(0, Math.min(100, rawWeightedScore / applicableWeightSum));

    const scoreBreakdown: ScoreBreakdown = {
      price: priceScores.get(evaluation.evaluationId) ?? null,
      eta: etaScores.get(evaluation.evaluationId) ?? null,
      availability: availabilityScores.get(evaluation.evaluationId) ?? null,
      providerPriority: priorityScores.get(evaluation.evaluationId) ?? null,
      serviceQuality: null,
      applicableWeightSum,
      rawWeightedScore,
    };

    return {
      ...evaluation,
      score,
      scoreBreakdown,
    };
  });
}

export function compareScoredEvaluations(
  a: ScoredEvaluation,
  b: ScoredEvaluation,
): number {
  if (b.score !== a.score) {
    return b.score - a.score;
  }

  const priceA = a.quote.amount?.amount ?? Number.POSITIVE_INFINITY;
  const priceB = b.quote.amount?.amount ?? Number.POSITIVE_INFINITY;
  if (priceA !== priceB) {
    return priceA - priceB;
  }

  const etaA =
    a.estimatedDeliveryMinutes ??
    (a.estimatedDeliveryAt
      ? a.estimatedDeliveryAt.getTime()
      : Number.POSITIVE_INFINITY);
  const etaB =
    b.estimatedDeliveryMinutes ??
    (b.estimatedDeliveryAt
      ? b.estimatedDeliveryAt.getTime()
      : Number.POSITIVE_INFINITY);
  if (etaA !== etaB) {
    return etaA - etaB;
  }

  if (a.providerPriority !== b.providerPriority) {
    return a.providerPriority - b.providerPriority;
  }

  return a.providerCode.localeCompare(b.providerCode);
}

export function buildSelectionReason(
  winner: ScoredEvaluation,
): string {
  const knownFactors: string[] = [];
  if (winner.scoreBreakdown.price != null) {
    knownFactors.push("price");
  }
  if (winner.scoreBreakdown.eta != null) {
    knownFactors.push("ETA");
  }
  if (winner.scoreBreakdown.providerPriority != null) {
    knownFactors.push("provider priority");
  }
  if (winner.scoreBreakdown.availability != null) {
    knownFactors.push("service availability");
  }

  if (knownFactors.length === 0) {
    return "Selected based on the strongest available provider signals.";
  }

  if (winner.scoreBreakdown.availability == null) {
    return `Selected based on the strongest available ${knownFactors.join(", ")} signals.`;
  }

  return `Selected because it provided the strongest overall combination of ${knownFactors.join(", ")}.`;
}
