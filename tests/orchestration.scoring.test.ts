import { describe, expect, it } from "vitest";
import {
  compareScoredEvaluations,
  scoreEligibleEvaluations,
} from "../src/modules/orchestration/orchestration.scoring.js";

function quote(amount: number) {
  return {
    available: true,
    amount: { amount, currency: "INR" },
    providerQuoteId: "Q1",
    estimatedDeliveryAt: null,
    estimatedDeliveryMinutes: 60,
    breakdown: null,
    quotedAt: new Date().toISOString(),
    reason: null,
  };
}

describe("Orchestration scoring", () => {
  it("scores lowest price highest among eligible providers", () => {
    const scored = scoreEligibleEvaluations([
      {
        evaluationId: "a",
        providerId: "1",
        providerCode: "A",
        providerPriority: 10,
        quote: quote(200),
        availability: { known: false, available: false, availableDriverCount: null, drivers: null, checkedAt: new Date().toISOString(), reason: null },
        estimatedDeliveryAt: null,
        estimatedDeliveryMinutes: 60,
      },
      {
        evaluationId: "b",
        providerId: "2",
        providerCode: "B",
        providerPriority: 20,
        quote: quote(100),
        availability: { known: false, available: false, availableDriverCount: null, drivers: null, checkedAt: new Date().toISOString(), reason: null },
        estimatedDeliveryAt: null,
        estimatedDeliveryMinutes: 60,
      },
    ]);

    const providerB = scored.find((item) => item.providerCode === "B");
    const providerA = scored.find((item) => item.providerCode === "A");
    expect(providerB?.scoreBreakdown.price).toBe(100);
    expect(providerA?.scoreBreakdown.price).toBe(0);
    expect(providerB!.score).toBeGreaterThan(providerA!.score);
  });

  it("omits availability factor when unknown and renormalizes", () => {
    const scored = scoreEligibleEvaluations([
      {
        evaluationId: "a",
        providerId: "1",
        providerCode: "A",
        providerPriority: 10,
        quote: quote(100),
        availability: {
          known: false,
          available: false,
          availableDriverCount: null,
          drivers: null,
          checkedAt: new Date().toISOString(),
          reason: "unknown",
        },
        estimatedDeliveryAt: null,
        estimatedDeliveryMinutes: 60,
      },
    ]);

    expect(scored[0]?.scoreBreakdown.availability).toBeNull();
    expect(scored[0]?.score).toBeLessThanOrEqual(100);
    expect(scored[0]?.score).toBeGreaterThanOrEqual(0);
  });

  it("uses deterministic tie-breaking by price then provider code", () => {
    const scored = scoreEligibleEvaluations([
      {
        evaluationId: "a",
        providerId: "1",
        providerCode: "B",
        providerPriority: 10,
        quote: quote(150),
        availability: null,
        estimatedDeliveryAt: null,
        estimatedDeliveryMinutes: 45,
      },
      {
        evaluationId: "b",
        providerId: "2",
        providerCode: "A",
        providerPriority: 10,
        quote: quote(150),
        availability: null,
        estimatedDeliveryAt: null,
        estimatedDeliveryMinutes: 45,
      },
    ]).sort(compareScoredEvaluations);

    expect(scored[0]?.providerCode).toBe("A");
  });
});
