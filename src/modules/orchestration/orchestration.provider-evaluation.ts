import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import type { DeliveryDetailDto } from "../delivery/delivery.types.js";
import {
  toQuoteRequest,
  toServiceabilityRequest,
  toAvailabilityRequest,
} from "../provider/adapters/delivery-provider.mapper.js";
import {
  ProviderAdapterExecutor,
  providerAdapterExecutor,
} from "../provider/adapters/provider-adapter-executor.js";
import {
  ProviderAdapterResolver,
  providerAdapterResolver,
} from "../provider/adapters/provider-adapter-resolver.js";
import {
  isQuoteProbeAdapter,
  type AdapterExecutionContext,
} from "../provider/adapters/provider-adapter.types.js";
import { ProviderAdapterError } from "../provider/contracts/provider-error.js";
import type { AvailabilityResult } from "../provider/contracts/availability.js";
import type { NormalizedQuote } from "../provider/contracts/quote.js";
import type { NormalizedServiceabilityResult } from "../provider/contracts/serviceability.js";
import type { ProviderWithRelations } from "../provider/provider.repository.js";
import {
  applyCancellationPolicyEligibility,
  resolveCancellationPolicy,
} from "./orchestration.cancellation-policy.js";
import { EXCLUSION_REASONS } from "./orchestration.constants.js";
import {
  evaluatePreAdapterCompatibility,
  providerHasCapability,
  resolvePrimaryService,
} from "./orchestration.eligibility.js";
import type { ProviderEvaluationOutcome } from "./orchestration.types.js";

function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!metadata) {
    return {};
  }
  const blocked = new Set([
    "authorization",
    "accessToken",
    "apiKey",
    "apiSecret",
    "token",
    "secret",
  ]);
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (blocked.has(key.toLowerCase())) {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

function defaultUnknownAvailability(): AvailabilityResult {
  return {
    known: false,
    available: false,
    availableDriverCount: null,
    drivers: null,
    checkedAt: new Date().toISOString(),
    reason: "Driver availability not provided",
  };
}

export class OrchestrationProviderEvaluationService {
  constructor(
    private readonly executor: ProviderAdapterExecutor = providerAdapterExecutor,
    private readonly resolver: ProviderAdapterResolver = providerAdapterResolver,
  ) {}

  async evaluateProvider(input: {
    provider: ProviderWithRelations;
    delivery: DeliveryDetailDto;
    requestId: string;
    testHints?: AdapterExecutionContext["testHints"];
  }): Promise<ProviderEvaluationOutcome> {
    const { provider, delivery, requestId, testHints } = input;
    const { serviceId, serviceCode } = resolvePrimaryService(provider);
    const baseSignals = {
      providerId: provider.id,
      providerCode: provider.code,
      providerServiceId: serviceId,
      providerServiceCode: serviceCode,
      serviceability: null as NormalizedServiceabilityResult | null,
      availability: null as AvailabilityResult | null,
      quote: null as NormalizedQuote | null,
      cancellationPolicy: null as ProviderEvaluationOutcome["signals"]["cancellationPolicy"],
      compatibility: {
        weightCompatible: true,
        dimensionsCompatible: true,
        requirementsCompatible: true,
        scheduleCompatible: true,
      },
      warnings: [] as string[],
      providerMetadata: {} as Record<string, unknown>,
    };

    const preCheck = evaluatePreAdapterCompatibility(provider, delivery);
    baseSignals.compatibility = preCheck.compatible;
    if (preCheck.exclusionReasons.length > 0) {
      return {
        status: "INELIGIBLE",
        signals: baseSignals,
        exclusionReasons: preCheck.exclusionReasons,
        eligibilityReasons: [],
        errorCategory: null,
        score: null,
        scoreBreakdown: null,
      };
    }

    if (testHints?.mockSimulateTimeout) {
      return this.errorOutcome(baseSignals, "PROVIDER_TIMEOUT");
    }
    if (testHints?.mockSimulateError) {
      return this.errorOutcome(baseSignals, "PROVIDER_ADAPTER_ERROR");
    }

    try {
      const resolved = await this.resolver.resolveForExecution({
        providerCode: provider.code,
        operation: "getQuote",
        requestId,
        requireReady: true,
      });

      const ctx: AdapterExecutionContext = {
        requestId,
        config: resolved.config,
        testHints,
      };

      const quoteRequest = toQuoteRequest(delivery, { serviceCode: serviceCode ?? undefined });
      let probeCancellationPolicy:
        | ProviderEvaluationOutcome["signals"]["cancellationPolicy"]
        | undefined = undefined;

      if (
        isQuoteProbeAdapter(resolved.adapter) &&
        !resolved.adapter.supportsOperation("checkServiceability")
      ) {
        const probe = await resolved.adapter.probeQuote(quoteRequest, ctx);
        baseSignals.serviceability = probe.serviceability;
        baseSignals.availability = probe.availability;
        baseSignals.quote = probe.quote;
        baseSignals.warnings = probe.warnings;
        baseSignals.providerMetadata = sanitizeMetadata(probe.providerMetadata);
        probeCancellationPolicy = probe.cancellationPolicy ?? null;
      } else {
        if (resolved.adapter.supportsOperation("checkServiceability")) {
          baseSignals.serviceability = await this.executor.execute({
            providerCode: provider.code,
            operation: "checkServiceability",
            payload: toServiceabilityRequest(delivery),
            requestId,
            testHints,
          });
        }

        if (
          providerHasCapability(provider, "AVAILABILITY") &&
          resolved.adapter.supportsOperation("getAvailability")
        ) {
          baseSignals.availability = await this.executor.execute({
            providerCode: provider.code,
            operation: "getAvailability",
            payload: toAvailabilityRequest(delivery, {
              serviceCode: serviceCode ?? undefined,
            }),
            requestId,
            testHints,
          });
        } else {
          baseSignals.availability = defaultUnknownAvailability();
        }

        baseSignals.quote = await this.executor.execute({
          providerCode: provider.code,
          operation: "getQuote",
          payload: quoteRequest,
          requestId,
          testHints,
        });
      }

      baseSignals.cancellationPolicy = await resolveCancellationPolicy({
        adapter: resolved.adapter,
        providerCode: provider.code,
        delivery,
        serviceCode,
        providerQuoteId: baseSignals.quote?.providerQuoteId,
        requestId,
        testHints,
        probePolicy: probeCancellationPolicy ?? undefined,
        executor: this.executor,
      });

      return this.buildOutcome(baseSignals);
    } catch (error) {
      const category = this.extractErrorCategory(error);
      if (
        category === "PROVIDER_ADAPTER_NOT_AVAILABLE" ||
        category === "PROVIDER_UNSUPPORTED_OPERATION" ||
        category === "PROVIDER_NOT_READY" ||
        category === "PROVIDER_DISABLED"
      ) {
        return {
          status: "SKIPPED",
          signals: baseSignals,
          exclusionReasons: [EXCLUSION_REASONS.ADAPTER_NOT_AVAILABLE],
          eligibilityReasons: [],
          errorCategory: category,
          score: null,
          scoreBreakdown: null,
        };
      }
      return this.errorOutcome(baseSignals, category);
    }
  }

  private buildOutcome(
    signals: ProviderEvaluationOutcome["signals"],
  ): ProviderEvaluationOutcome {
    const exclusionReasons: string[] = [];

    if (signals.serviceability && !signals.serviceability.serviceable) {
      exclusionReasons.push(EXCLUSION_REASONS.ROUTE_NOT_SERVICEABLE);
    }

    if (signals.quote && !signals.quote.available) {
      exclusionReasons.push(EXCLUSION_REASONS.QUOTE_UNAVAILABLE);
    }

    if (
      signals.availability?.known === true &&
      signals.availability.available === false
    ) {
      exclusionReasons.push(EXCLUSION_REASONS.NO_DRIVER_AVAILABILITY);
    }

    const withCancellation = applyCancellationPolicyEligibility({
      policy: signals.cancellationPolicy ?? {
        supported: false,
        allowedBeforePickup: false,
        allowedAfterPickup: false,
        fee: { type: "UNKNOWN" },
        conditions: [],
        policyKnown: false,
        source: "UNKNOWN",
      },
      exclusionReasons,
    });

    if (withCancellation.length > 0) {
      return {
        status: "INELIGIBLE",
        signals,
        exclusionReasons: withCancellation,
        eligibilityReasons: [],
        errorCategory: null,
        score: null,
        scoreBreakdown: null,
      };
    }

    if (!signals.quote?.available || !signals.serviceability?.serviceable) {
      return {
        status: "INELIGIBLE",
        signals,
        exclusionReasons: [EXCLUSION_REASONS.QUOTE_UNAVAILABLE],
        eligibilityReasons: [],
        errorCategory: null,
        score: null,
        scoreBreakdown: null,
      };
    }

    return {
      status: "ELIGIBLE",
      signals,
      exclusionReasons: [],
      eligibilityReasons: ["PROVIDER_ELIGIBLE"],
      errorCategory: null,
      score: null,
      scoreBreakdown: null,
    };
  }

  private errorOutcome(
    signals: ProviderEvaluationOutcome["signals"],
    category: string,
  ): ProviderEvaluationOutcome {
    return {
      status: "ERROR",
      signals,
      exclusionReasons: [],
      eligibilityReasons: [],
      errorCategory: category,
      score: null,
      scoreBreakdown: null,
    };
  }

  private extractErrorCategory(error: unknown): string {
    if (error instanceof AppError) {
      return error.code;
    }
    if (error instanceof ProviderAdapterError) {
      return error.category;
    }
    return ErrorCodes.PROVIDER_ADAPTER_ERROR;
  }
}

export const orchestrationProviderEvaluationService =
  new OrchestrationProviderEvaluationService();
