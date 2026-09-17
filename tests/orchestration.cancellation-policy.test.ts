import { describe, expect, it } from "vitest";
import { SCORE_WEIGHTS } from "../src/modules/orchestration/orchestration.constants.js";
import { scoreEligibleEvaluations } from "../src/modules/orchestration/orchestration.scoring.js";
import type { ScorableEvaluation } from "../src/modules/orchestration/orchestration.scoring.js";

describe("Orchestration cancellation policy scoring regression", () => {
  it("does not add cancellation as a scoring factor", () => {
    expect(SCORE_WEIGHTS).toEqual({
      PRICE: 40,
      ETA: 25,
      AVAILABILITY: 20,
      PROVIDER_PRIORITY: 10,
      SERVICE_QUALITY: 5,
    });
  });

  it("scores eligible providers without cancellation in breakdown", () => {
    const evaluations: ScorableEvaluation[] = [
      {
        evaluationId: "a",
        providerId: "p1",
        providerCode: "MOCK_A",
        providerPriority: 1,
        quote: {
          available: true,
          amount: { amount: 100, currency: "INR" },
          providerQuoteId: "Q1",
          estimatedDeliveryAt: null,
          estimatedDeliveryMinutes: 30,
          breakdown: null,
          quotedAt: new Date().toISOString(),
          reason: null,
        },
        availability: { known: false, available: false, availableDriverCount: null, drivers: null, checkedAt: new Date().toISOString(), reason: null },
        estimatedDeliveryAt: null,
        estimatedDeliveryMinutes: 30,
      },
      {
        evaluationId: "b",
        providerId: "p2",
        providerCode: "MOCK_B",
        providerPriority: 2,
        quote: {
          available: true,
          amount: { amount: 200, currency: "INR" },
          providerQuoteId: "Q2",
          estimatedDeliveryAt: null,
          estimatedDeliveryMinutes: 60,
          breakdown: null,
          quotedAt: new Date().toISOString(),
          reason: null,
        },
        availability: { known: false, available: false, availableDriverCount: null, drivers: null, checkedAt: new Date().toISOString(), reason: null },
        estimatedDeliveryAt: null,
        estimatedDeliveryMinutes: 60,
      },
    ];

    const scored = scoreEligibleEvaluations(evaluations);
    expect(scored[0]?.providerCode).toBe("MOCK_A");
    for (const item of scored) {
      expect(item.scoreBreakdown).not.toHaveProperty("cancellation");
    }
  });
});
