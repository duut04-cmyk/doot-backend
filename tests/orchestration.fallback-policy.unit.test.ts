import { describe, expect, it } from "vitest";
import {
  isOrchestrationFailFastError,
  partitionOrchestrationProviders,
  shouldRunFallbackTier,
} from "../src/modules/orchestration/orchestration.fallback-policy.js";
import type { ProviderWithRelations } from "../src/modules/provider/provider.repository.js";
import type { ProviderEvaluationOutcome } from "../src/modules/orchestration/orchestration.types.js";

function provider(code: string, priority: number): ProviderWithRelations {
  return {
    id: code,
    code,
    priority,
  } as ProviderWithRelations;
}

describe("orchestration.fallback-policy", () => {
  it("partitions preferred and fallback providers", () => {
    const tiers = partitionOrchestrationProviders(
      [provider("SHIPROCKET", 1), provider("MOCK", 2)],
      "SHIPROCKET",
    );
    expect(tiers.useTieredEvaluation).toBe(true);
    expect(tiers.preferred.map((item) => item.code)).toEqual(["SHIPROCKET"]);
    expect(tiers.fallback.map((item) => item.code)).toEqual(["MOCK"]);
  });

  it("classifies fail-fast auth errors", () => {
    expect(isOrchestrationFailFastError("PROVIDER_AUTHENTICATION_ERROR")).toBe(true);
    expect(isOrchestrationFailFastError("PROVIDER_TIMEOUT")).toBe(false);
  });

  it("skips fallback when preferred has eligible outcomes", () => {
    const preferredOutcomes = [{ status: "ELIGIBLE" }] as ProviderEvaluationOutcome[];
    expect(
      shouldRunFallbackTier({
        useTieredEvaluation: true,
        preferredOutcomes,
      }),
    ).toBe(false);
  });
});
