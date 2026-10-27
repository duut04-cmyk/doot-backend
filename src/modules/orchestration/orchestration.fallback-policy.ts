import type { ProviderWithRelations } from "../provider/provider.repository.js";
import type { ProviderEvaluationOutcome } from "./orchestration.types.js";

/** Provider HTTP / adapter errors that must not trigger fallback tier evaluation. */
export const ORCHESTRATION_FAIL_FAST_ERROR_CATEGORIES = new Set<string>([
  "PROVIDER_AUTHENTICATION_ERROR",
  "PROVIDER_AUTHORIZATION_ERROR",
  "PROVIDER_VALIDATION_ERROR",
  "PROVIDER_NOT_READY",
  "PROVIDER_DISABLED",
]);

export function isOrchestrationFailFastError(errorCategory: string | null): boolean {
  if (!errorCategory) {
    return false;
  }
  return ORCHESTRATION_FAIL_FAST_ERROR_CATEGORIES.has(errorCategory);
}

export type OrchestrationProviderTiers = {
  useTieredEvaluation: boolean;
  preferred: ProviderWithRelations[];
  fallback: ProviderWithRelations[];
};

export function partitionOrchestrationProviders(
  providers: ProviderWithRelations[],
  preferredProviderCode: string | undefined,
): OrchestrationProviderTiers {
  const normalizedPreferred = preferredProviderCode?.trim().toUpperCase();
  if (!normalizedPreferred) {
    return {
      useTieredEvaluation: false,
      preferred: [],
      fallback: providers,
    };
  }

  const preferred = providers.filter(
    (provider) => provider.code.toUpperCase() === normalizedPreferred,
  );
  const fallback = providers.filter(
    (provider) => provider.code.toUpperCase() !== normalizedPreferred,
  );

  return {
    useTieredEvaluation: preferred.length > 0,
    preferred,
    fallback,
  };
}

export function preferredTierHasEligibleOutcomes(
  outcomes: ProviderEvaluationOutcome[],
): boolean {
  return outcomes.some((outcome) => outcome.status === "ELIGIBLE");
}

export function preferredTierHasFailFastError(
  outcomes: ProviderEvaluationOutcome[],
): boolean {
  return outcomes.some(
    (outcome) =>
      outcome.status === "ERROR" && isOrchestrationFailFastError(outcome.errorCategory),
  );
}

export function shouldRunFallbackTier(input: {
  useTieredEvaluation: boolean;
  preferredOutcomes: ProviderEvaluationOutcome[];
}): boolean {
  if (!input.useTieredEvaluation) {
    return false;
  }
  if (preferredTierHasEligibleOutcomes(input.preferredOutcomes)) {
    return false;
  }
  if (preferredTierHasFailFastError(input.preferredOutcomes)) {
    return false;
  }
  return true;
}
