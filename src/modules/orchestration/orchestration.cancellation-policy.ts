import { logger } from "../../config/logger.js";
import type { DeliveryDetailDto } from "../delivery/delivery.types.js";
import {
  ProviderAdapterExecutor,
  providerAdapterExecutor,
} from "../provider/adapters/provider-adapter-executor.js";
import type {
  AdapterExecutionContext,
  ProviderAdapter,
} from "../provider/adapters/provider-adapter.types.js";
import type { CancellationPolicy } from "../provider/contracts/cancellation-policy.js";
import { unknownCancellationPolicy } from "../provider/contracts/cancellation-policy.js";
import {
  EXCLUSION_REASONS,
  REQUIRE_KNOWN_CANCELLATION_POLICY,
} from "./orchestration.constants.js";

export async function resolveCancellationPolicy(input: {
  adapter: ProviderAdapter;
  providerCode: string;
  delivery: DeliveryDetailDto;
  serviceCode: string | null | undefined;
  providerQuoteId: string | null | undefined;
  requestId: string;
  testHints?: AdapterExecutionContext["testHints"];
  probePolicy?: CancellationPolicy;
  executor?: ProviderAdapterExecutor;
}): Promise<CancellationPolicy> {
  const exec = input.executor ?? providerAdapterExecutor;

  if (input.probePolicy) {
    logger.debug(
      {
        requestId: input.requestId,
        providerCode: input.providerCode,
        policyKnown: input.probePolicy.policyKnown,
        source: input.probePolicy.source,
      },
      "cancellation_policy_evaluated",
    );
    return input.probePolicy;
  }

  if (input.adapter.supportsOperation("getCancellationPolicy")) {
    try {
      const policy = await exec.execute({
        providerCode: input.providerCode,
        operation: "getCancellationPolicy",
        payload: {
          deliveryId: input.delivery.id,
          deliveryReference: input.delivery.reference,
          serviceCode: input.serviceCode ?? undefined,
          providerQuoteId: input.providerQuoteId ?? null,
        },
        requestId: input.requestId,
        testHints: input.testHints,
      });

      logger.debug(
        {
          requestId: input.requestId,
          providerCode: input.providerCode,
          policyKnown: policy.policyKnown,
          source: policy.source,
        },
        "cancellation_policy_evaluated",
      );

      return policy;
    } catch (error) {
      logger.warn(
        {
          requestId: input.requestId,
          providerCode: input.providerCode,
          err: error instanceof Error ? error.message : "unknown",
        },
        "cancellation_policy_evaluation_failed",
      );
      return unknownCancellationPolicy();
    }
  }

  logger.debug(
    {
      requestId: input.requestId,
      providerCode: input.providerCode,
    },
    "cancellation_policy_unknown",
  );

  return unknownCancellationPolicy();
}

export function applyCancellationPolicyEligibility(input: {
  policy: CancellationPolicy;
  exclusionReasons: string[];
}): string[] {
  const reasons = [...input.exclusionReasons];

  if (
    REQUIRE_KNOWN_CANCELLATION_POLICY &&
    !input.policy.policyKnown
  ) {
    if (!reasons.includes(EXCLUSION_REASONS.CANCELLATION_POLICY_UNKNOWN)) {
      reasons.push(EXCLUSION_REASONS.CANCELLATION_POLICY_UNKNOWN);
    }
    logger.info(
      {
        policyKnown: false,
        source: input.policy.source,
      },
      "provider_excluded_unknown_cancellation_policy",
    );
  }

  return reasons;
}
