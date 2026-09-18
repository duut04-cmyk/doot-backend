import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { DeliveryService } from "../src/modules/delivery/delivery.service.js";
import * as orchestrationEligibility from "../src/modules/orchestration/orchestration.eligibility.js";
import { OrchestrationProviderEvaluationService } from "../src/modules/orchestration/orchestration.provider-evaluation.js";
import { OrchestrationService } from "../src/modules/orchestration/orchestration.service.js";
import type { ProviderEvaluationOutcome } from "../src/modules/orchestration/orchestration.types.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { knownFixedFeeCancellationPolicy } from "./helpers/cancellation-policy-test-helpers.js";
import { seedOrchestrationMockProvider } from "./helpers/provider-adapter-test-helpers.js";
import { phoneValue } from "./helpers/phone-test-helpers.js";

function eligibleOutcome(input: {
  providerId: string;
  providerCode: string;
  amount: number;
}): ProviderEvaluationOutcome {
  return {
    status: "ELIGIBLE",
    signals: {
      providerId: input.providerId,
      providerCode: input.providerCode,
      providerServiceId: null,
      providerServiceCode: "MOCK_BIKE",
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
        providerQuoteId: "Q1",
        estimatedDeliveryAt: null,
        estimatedDeliveryMinutes: 45,
        breakdown: null,
        quotedAt: new Date().toISOString(),
        reason: null,
      },
      cancellationPolicy: knownFixedFeeCancellationPolicy(),
      compatibility: {
        weightCompatible: true,
        dimensionsCompatible: true,
        requirementsCompatible: true,
        scheduleCompatible: true,
      },
      warnings: [],
      providerMetadata: {},
    },
    exclusionReasons: [],
    eligibilityReasons: ["PROVIDER_ELIGIBLE"],
    errorCategory: null,
    score: null,
    scoreBreakdown: null,
  };
}

function errorOutcome(input: {
  providerId: string;
  providerCode: string;
}): ProviderEvaluationOutcome {
  return {
    status: "ERROR",
    signals: {
      providerId: input.providerId,
      providerCode: input.providerCode,
      providerServiceId: null,
      providerServiceCode: null,
      serviceability: null,
      availability: null,
      quote: null,
      cancellationPolicy: null,
      compatibility: {
        weightCompatible: true,
        dimensionsCompatible: true,
        requirementsCompatible: true,
        scheduleCompatible: true,
      },
      warnings: [],
      providerMetadata: {},
    },
    exclusionReasons: [],
    eligibilityReasons: [],
    errorCategory: ErrorCodes.PROVIDER_ADAPTER_ERROR,
    score: null,
    scoreBreakdown: null,
  };
}

describe("Orchestration failure resilience", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let providerRepo: InMemoryProviderRepository;
  let orchestrationRepo: InMemoryOrchestrationRepository;
  let deliveryService: DeliveryService;
  let customerId: string;
  let evaluateMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    deliveryRepo = new InMemoryDeliveryRepository();
    providerRepo = new InMemoryProviderRepository();
    orchestrationRepo = new InMemoryOrchestrationRepository();
    deliveryService = new DeliveryService(deliveryRepo);
    customerId = randomUUID();
    evaluateMock = vi.fn();
    vi.spyOn(
      orchestrationEligibility,
      "isProviderOrchestrationCandidate",
    ).mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function createDelivery() {
    const created = await deliveryService.createDelivery({
      customerId,
      body: {
        pickup: {
          addressText: "Pickup",
          contactName: "A",
          contactPhone: phoneValue("+91", "9876543210"),
        },
        drop: {
          addressText: "Drop",
          contactName: "B",
          contactPhone: phoneValue("+91", "9811122233"),
        },
        package: {
          packageType: "FOOD",
          weightKg: 1.5,
          sizeTier: "MEDIUM",
          quantity: 1,
        },
        requirements: [],
        schedule: { mode: "ASAP", timezone: "Asia/Kolkata" },
        compliance: { accepted: true },
      },
      idempotencyKey: randomUUID(),
    });
    return created.data.id;
  }

  function buildService() {
    const evaluationService = {
      evaluateProvider: evaluateMock,
    } as unknown as OrchestrationProviderEvaluationService;
    return new OrchestrationService(
      deliveryRepo,
      providerRepo,
      orchestrationRepo,
      evaluationService,
    );
  }

  it("selects eligible provider when another provider errors", async () => {
    const providerA = await seedOrchestrationMockProvider(providerRepo, {
      code: "MOCK_A",
      priority: 1,
    });
    const providerB = await seedOrchestrationMockProvider(providerRepo, {
      code: "MOCK_B",
      priority: 2,
    });

    evaluateMock.mockImplementation(async ({ provider }) => {
      if (provider.code === "MOCK_A") {
        return errorOutcome({ providerId: providerA, providerCode: "MOCK_A" });
      }
      return eligibleOutcome({
        providerId: providerB,
        providerCode: "MOCK_B",
        amount: 180,
      });
    });

    const deliveryId = await createDelivery();
    const result = await buildService().orchestrate({
      deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-orch-fail-1",
    });

    expect(result.data.status).toBe("OPTION_READY");
    expect(result.data.orchestration.selectedOption?.providerCode).toBe("MOCK_B");

    const errorEval = orchestrationRepo.evaluations.find(
      (item) => item.status === "ERROR",
    );
    expect(errorEval?.providerCode).toBe("MOCK_A");
    expect(errorEval?.errorCategory).toBe(ErrorCodes.PROVIDER_ADAPTER_ERROR);
  });

  it("records ERROR when all providers fail during evaluation", async () => {
    await seedOrchestrationMockProvider(providerRepo, { code: "MOCK_A" });
    await seedOrchestrationMockProvider(providerRepo, { code: "MOCK_B" });

    evaluateMock.mockImplementation(async ({ provider }) =>
      errorOutcome({
        providerId: provider.id,
        providerCode: provider.code,
      }),
    );

    const deliveryId = await createDelivery();
    const result = await buildService().orchestrate({
      deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-orch-fail-2",
    });

    expect(result.data.status).toBe("FAILED");
    expect(result.data.orchestration.selectedOption).toBeNull();
    expect(orchestrationRepo.evaluations.every((item) => item.status === "ERROR")).toBe(
      true,
    );
  });

  it("isolates rejected evaluation promises via Promise.allSettled", async () => {
    const providerA = await seedOrchestrationMockProvider(providerRepo, {
      code: "MOCK_A",
      priority: 1,
    });
    const providerB = await seedOrchestrationMockProvider(providerRepo, {
      code: "MOCK_B",
      priority: 2,
    });

    evaluateMock.mockImplementation(async ({ provider }) => {
      if (provider.code === "MOCK_A") {
        throw new Error("Unexpected evaluation crash");
      }
      return eligibleOutcome({
        providerId: providerB,
        providerCode: "MOCK_B",
        amount: 120,
      });
    });

    const deliveryId = await createDelivery();
    const result = await buildService().orchestrate({
      deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-orch-fail-3",
    });

    expect(result.data.status).toBe("OPTION_READY");
    expect(result.data.orchestration.selectedOption?.providerCode).toBe("MOCK_B");
    expect(
      orchestrationRepo.evaluations.some(
        (item) => item.providerId === providerA && item.status === "ERROR",
      ),
    ).toBe(true);
  });

  it("does not select a provider solely because another failed with higher score potential", async () => {
    const providerA = await seedOrchestrationMockProvider(providerRepo, {
      code: "MOCK_A",
      priority: 1,
    });
    const providerB = await seedOrchestrationMockProvider(providerRepo, {
      code: "MOCK_B",
      priority: 2,
    });

    evaluateMock.mockImplementation(async ({ provider }) => {
      if (provider.code === "MOCK_A") {
        return errorOutcome({ providerId: providerA, providerCode: "MOCK_A" });
      }
      return eligibleOutcome({
        providerId: providerB,
        providerCode: "MOCK_B",
        amount: 250,
      });
    });

    const deliveryId = await createDelivery();
    const result = await buildService().orchestrate({
      deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-orch-fail-4",
    });

    expect(result.data.orchestration.selectedOption?.providerCode).toBe("MOCK_B");
    const winnerEval = orchestrationRepo.evaluations.find(
      (item) => item.providerCode === "MOCK_B" && item.status === "ELIGIBLE",
    );
    expect(winnerEval?.quoteAmount).toBe(250);
  });
});
