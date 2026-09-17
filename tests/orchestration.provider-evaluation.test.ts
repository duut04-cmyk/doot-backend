import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXCLUSION_REASONS } from "../src/modules/orchestration/orchestration.constants.js";
import { OrchestrationProviderEvaluationService } from "../src/modules/orchestration/orchestration.provider-evaluation.js";
import { ProviderAdapterExecutor } from "../src/modules/provider/adapters/provider-adapter-executor.js";
import { ProviderAdapterResolver } from "../src/modules/provider/adapters/provider-adapter-resolver.js";
import { MockProviderAdapter } from "../src/modules/provider/adapters/mock/mock-provider.adapter.js";
import {
  knownFixedFeeCancellationPolicy,
  knownFreeCancellationPolicy,
  unknownCancellationPolicy,
} from "./helpers/cancellation-policy-test-helpers.js";
import type { DeliveryDetailDto } from "../src/modules/delivery/delivery.types.js";
import type { ProviderWithRelations } from "../src/modules/provider/provider.repository.js";

function sampleDelivery(): DeliveryDetailDto {
  return {
    id: randomUUID(),
    reference: "DOTT-1001",
    customerId: randomUUID(),
    status: "CREATED",
    pickup: {
      addressText: "Pickup",
      contactName: "A",
      contactPhone: { countryCode: "+91", number: "9876543210" },
      instructions: null,
      latitude: null,
      longitude: null,
    },
    drop: {
      addressText: "Drop",
      contactName: "B",
      contactPhone: { countryCode: "+91", number: "9811122233" },
      instructions: null,
      latitude: null,
      longitude: null,
    },
    package: {
      packageType: "FOOD",
      description: null,
      weightKg: 1.5,
      lengthCm: null,
      widthCm: null,
      heightCm: null,
      sizeTier: "MEDIUM",
      quantity: 1,
      photos: [],
    },
    requirements: [],
    specialInstructions: null,
    schedule: { mode: "ASAP", timezone: "Asia/Kolkata" },
    compliance: { accepted: true, acceptedAt: new Date().toISOString() },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function sampleProvider(code = "MOCK"): ProviderWithRelations {
  return {
    id: randomUUID(),
    code,
    name: code,
    status: "ACTIVE",
    enabled: true,
    orchestrationEnabled: true,
    integrationStatus: "READY",
    healthStatus: "HEALTHY",
    priority: 1,
    capabilities: [{ capability: "CANCELLATION" }],
    services: [{ id: randomUUID(), code: "MOCK_BIKE", name: "Mock Bike", enabled: true }],
    vehicles: [],
    limits: [],
    credentials: [],
    settings: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as ProviderWithRelations;
}

describe("OrchestrationProviderEvaluationService cancellation policy", () => {
  let executor: ProviderAdapterExecutor;
  let resolver: ProviderAdapterResolver;
  let service: OrchestrationProviderEvaluationService;

  beforeEach(() => {
    const adapter = new MockProviderAdapter();
    executor = {
      execute: vi.fn(async (input) => adapter.execute(input.operation, input.payload, {
        requestId: input.requestId,
        config: { providerCode: "MOCK" } as never,
        testHints: input.testHints,
      })),
    } as unknown as ProviderAdapterExecutor;
    resolver = {
      resolveForExecution: vi.fn(async () => ({
        adapter,
        config: { providerCode: "MOCK" } as never,
      })),
    } as unknown as ProviderAdapterResolver;
    service = new OrchestrationProviderEvaluationService(executor, resolver);
  });

  it("evaluates known cancellation policy before marking eligible", async () => {
    const outcome = await service.evaluateProvider({
      provider: sampleProvider(),
      delivery: sampleDelivery(),
      requestId: "req-eval-1",
    });

    expect(outcome.status).toBe("ELIGIBLE");
    expect(outcome.signals.cancellationPolicy?.policyKnown).toBe(true);
    expect(outcome.signals.cancellationPolicy?.fee).toEqual({
      type: "FIXED",
      amount: 50,
      currency: "INR",
    });
  });

  it("marks provider ineligible when cancellation policy is unknown", async () => {
    const outcome = await service.evaluateProvider({
      provider: sampleProvider(),
      delivery: sampleDelivery(),
      requestId: "req-eval-2",
      testHints: { mockCancellationPolicyKnown: false },
    });

    expect(outcome.status).toBe("INELIGIBLE");
    expect(outcome.exclusionReasons).toContain(
      EXCLUSION_REASONS.CANCELLATION_POLICY_UNKNOWN,
    );
    expect(outcome.signals.cancellationPolicy?.policyKnown).toBe(false);
  });

  it("keeps provider eligible with known free cancellation", async () => {
    const outcome = await service.evaluateProvider({
      provider: sampleProvider(),
      delivery: sampleDelivery(),
      requestId: "req-eval-3",
      testHints: { mockCancellationPolicy: knownFreeCancellationPolicy() },
    });

    expect(outcome.status).toBe("ELIGIBLE");
    expect(outcome.signals.cancellationPolicy?.fee.type).toBe("NONE");
  });

  it("keeps provider eligible with explicit non-cancellable policy", async () => {
    const outcome = await service.evaluateProvider({
      provider: sampleProvider(),
      delivery: sampleDelivery(),
      requestId: "req-eval-4",
      testHints: {
        mockCancellationPolicy: knownFixedFeeCancellationPolicy({
          allowedBeforePickup: false,
          fee: { type: "NONE" },
        }),
      },
    });

    expect(outcome.status).toBe("ELIGIBLE");
    expect(outcome.signals.cancellationPolicy?.allowedBeforePickup).toBe(false);
  });

  it("preserves custom known policy from test hints", async () => {
    const custom = knownFixedFeeCancellationPolicy({
      fee: { type: "PERCENTAGE", amount: 10, currency: "INR" },
    });
    const outcome = await service.evaluateProvider({
      provider: sampleProvider(),
      delivery: sampleDelivery(),
      requestId: "req-eval-5",
      testHints: { mockCancellationPolicy: custom },
    });

    expect(outcome.signals.cancellationPolicy).toEqual(custom);
  });

  it("does not treat unknown policy as free cancellation", async () => {
    const outcome = await service.evaluateProvider({
      provider: sampleProvider(),
      delivery: sampleDelivery(),
      requestId: "req-eval-6",
      testHints: { mockCancellationPolicy: unknownCancellationPolicy() },
    });

    expect(outcome.signals.cancellationPolicy?.fee.type).toBe("UNKNOWN");
    expect(outcome.status).toBe("INELIGIBLE");
  });
});
