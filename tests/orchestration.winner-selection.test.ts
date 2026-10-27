import { describe, expect, it } from "vitest";
import {
  buildScorableEligibleEvaluations,
  resolveOutcomeIndexForWinner,
  resolvePersistedEvaluationForWinner,
} from "../src/modules/orchestration/orchestration.winner-selection.js";
import {
  compareScoredEvaluations,
  scoreEligibleEvaluations,
} from "../src/modules/orchestration/orchestration.scoring.js";
import type { ProviderEvaluationOutcome } from "../src/modules/orchestration/orchestration.types.js";
import { knownFixedFeeCancellationPolicy } from "./helpers/cancellation-policy-test-helpers.js";

function hyperlocalRateOutcome(input: {
  providerId: string;
  amount: number;
  providerQuoteId: string;
  courierName: string;
}): ProviderEvaluationOutcome {
  return {
    status: "ELIGIBLE",
    signals: {
      providerId: input.providerId,
      providerCode: "SHIPROCKET",
      providerServiceId: null,
      providerServiceCode: "HL",
      serviceability: {
        serviceable: true,
        providerReference: null,
        reason: null,
        availableServices: [],
        checkedAt: new Date().toISOString(),
      },
      availability: {
        known: false,
        available: false,
        availableDriverCount: null,
        drivers: null,
        checkedAt: new Date().toISOString(),
        reason: null,
      },
      quote: {
        available: true,
        amount: { amount: input.amount, currency: "INR" },
        providerQuoteId: input.providerQuoteId,
        estimatedDeliveryAt: null,
        estimatedDeliveryMinutes: 30,
        breakdown: null,
        quotedAt: new Date().toISOString(),
        reason: null,
      },
      compatibility: {
        weightCompatible: true,
        dimensionsCompatible: true,
        requirementsCompatible: true,
        scheduleCompatible: true,
      },
      warnings: [],
      providerMetadata: {
        shiprocketHyperlocalRate: {
          courier_name: input.courierName,
          rates: input.amount,
        },
        courier_company_id: input.providerQuoteId,
      },
      cancellationPolicy: knownFixedFeeCancellationPolicy(),
    },
    exclusionReasons: [],
    eligibilityReasons: ["PROVIDER_ELIGIBLE"],
    errorCategory: null,
    score: null,
    scoreBreakdown: null,
  };
}

describe("orchestration winner selection", () => {
  it("maps multi-rate outcomes to distinct outcome indexes and winning evaluation", () => {
    const providerId = "shiprocket-uuid";
    const outcomes = [
      hyperlocalRateOutcome({
        providerId,
        amount: 120,
        providerQuoteId: "courier-slow",
        courierName: "Slow",
      }),
      hyperlocalRateOutcome({
        providerId,
        amount: 80,
        providerQuoteId: "courier-fast",
        courierName: "Fast",
      }),
    ];

    const scorable = buildScorableEligibleEvaluations(outcomes, () => 1);
    expect(scorable.map((row) => row.outcomeIndex)).toEqual([0, 1]);

    const winner = scoreEligibleEvaluations(scorable).sort(
      compareScoredEvaluations,
    )[0]!;
    expect(winner.quote.providerQuoteId).toBe("courier-fast");
    expect(resolveOutcomeIndexForWinner(winner, outcomes)).toBe(1);

    const persisted = outcomes.map((outcome, index) => ({
      id: `eval-${index}`,
      providerId: outcome.signals.providerId,
      quoteAmount: outcome.signals.quote?.amount?.amount ?? null,
      providerQuoteId: outcome.signals.quote?.providerQuoteId ?? null,
    }));

    const winnerEvaluation = resolvePersistedEvaluationForWinner(
      persisted,
      winner,
      outcomes,
    );
    expect(winnerEvaluation?.id).toBe("eval-1");
    expect(winnerEvaluation?.providerQuoteId).toBe("courier-fast");
  });
});
