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
import {
  defaultCancellationPolicySnapshot,
  knownFixedFeeCancellationPolicy,
} from "./helpers/cancellation-policy-test-helpers.js";
import { seedOrchestrationMockProvider } from "./helpers/provider-adapter-test-helpers.js";
import { phoneValue } from "./helpers/phone-test-helpers.js";

function eligibleOutcome(input: {
  providerId: string;
  providerCode: string;
  amount: number;
  etaMinutes?: number;
  availabilityKnown?: boolean;
  availabilityAvailable?: boolean;
  driverCount?: number | null;
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
        known: input.availabilityKnown ?? false,
        available: input.availabilityAvailable ?? false,
        availableDriverCount:
          input.driverCount !== undefined ? input.driverCount : null,
        drivers: null,
        checkedAt: new Date().toISOString(),
        reason: null,
      },
      quote: {
        available: true,
        amount: { amount: input.amount, currency: "INR" },
        providerQuoteId: "Q1",
        estimatedDeliveryAt: null,
        estimatedDeliveryMinutes: input.etaMinutes ?? 60,
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
      providerMetadata: {},
      cancellationPolicy: knownFixedFeeCancellationPolicy(),
    },
    exclusionReasons: [],
    eligibilityReasons: ["PROVIDER_ELIGIBLE"],
    errorCategory: null,
    score: null,
    scoreBreakdown: null,
  };
}

describe("OrchestrationService", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let providerRepo: InMemoryProviderRepository;
  let orchestrationRepo: InMemoryOrchestrationRepository;
  let deliveryService: DeliveryService;
  let customerId: string;
  let evaluateMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
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

  it("transitions CREATED to OPTION_READY and selects best provider", async () => {
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
        return eligibleOutcome({
          providerId: providerA,
          providerCode: "MOCK_A",
          amount: 170,
          etaMinutes: 60,
        });
      }
      return eligibleOutcome({
        providerId: providerB,
        providerCode: "MOCK_B",
        amount: 200,
        etaMinutes: 45,
        availabilityKnown: true,
        availabilityAvailable: true,
        driverCount: 2,
      });
    });

    const deliveryId = await createDelivery();
    const service = buildService();
    const result = await service.orchestrate({
      deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-1",
    });

    expect(result.data.status).toBe("OPTION_READY");
    expect(result.data.orchestration.selectedOption?.providerCode).toBe("MOCK_A");
    const delivery = await deliveryRepo.findById(deliveryId);
    expect(delivery?.status).toBe("OPTION_READY");
    expect(orchestrationRepo.evaluations.length).toBe(2);
    expect(orchestrationRepo.options.length).toBe(1);
  });

  it("excludes known-unavailable provider but keeps unknown-availability provider eligible", async () => {
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
        return eligibleOutcome({
          providerId: providerA,
          providerCode: "MOCK_A",
          amount: 100,
          availabilityKnown: false,
        });
      }
      return {
        status: "INELIGIBLE",
        signals: eligibleOutcome({
          providerId: providerB,
          providerCode: "MOCK_B",
          amount: 150,
          availabilityKnown: true,
          availabilityAvailable: false,
          driverCount: 0,
        }).signals,
        exclusionReasons: ["NO_DRIVER_AVAILABILITY"],
        eligibilityReasons: [],
        errorCategory: null,
        score: null,
        scoreBreakdown: null,
      };
    });

    const deliveryId = await createDelivery();
    const result = await buildService().orchestrate({
      deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-2",
    });

    expect(result.data.orchestration.selectedOption?.providerCode).toBe("MOCK_A");
  });

  it("transitions to FAILED when no eligible provider exists", async () => {
    await seedOrchestrationMockProvider(providerRepo, { code: "MOCK_A" });
    evaluateMock.mockResolvedValue({
      status: "INELIGIBLE",
      signals: eligibleOutcome({
        providerId: "x",
        providerCode: "MOCK_A",
        amount: 100,
      }).signals,
      exclusionReasons: ["ROUTE_NOT_SERVICEABLE"],
      eligibilityReasons: [],
      errorCategory: null,
      score: null,
      scoreBreakdown: null,
    });

    const deliveryId = await createDelivery();
    const result = await buildService().orchestrate({
      deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-3",
    });

    expect(result.data.status).toBe("FAILED");
    expect(result.data.orchestration.selectedOption).toBeNull();
  });

  it("returns existing result when delivery is already OPTION_READY", async () => {
    const deliveryId = await createDelivery();
    await deliveryRepo.transitionStatus({
      deliveryId,
      expectedFromStatuses: ["CREATED"],
      toStatus: "ORCHESTRATING",
      source: "ORCHESTRATION",
      reason: "test",
    });
    await deliveryRepo.transitionStatus({
      deliveryId,
      expectedFromStatuses: ["ORCHESTRATING"],
      toStatus: "OPTION_READY",
      source: "ORCHESTRATION",
      reason: "test",
    });

    const request = await orchestrationRepo.createRequest({
      deliveryId,
      requestedByUserId: customerId,
      attemptNumber: 1,
    });
    await orchestrationRepo.completeRequest({
      requestId: request.id,
      status: "COMPLETED",
    });
    await orchestrationRepo.createEvaluations([
      {
        orchestrationRequestId: request.id,
        providerId: randomUUID(),
        providerServiceId: null,
        providerCode: "MOCK_A",
        providerServiceCode: "MOCK_BIKE",
        status: "ELIGIBLE",
        serviceable: true,
        availabilityKnown: false,
        available: null,
        availableDriverCount: null,
        quoteAvailable: true,
        quoteAmount: 150,
        quoteCurrency: "INR",
        estimatedDeliveryAt: null,
        eligibilityReasons: [],
        exclusionReasons: [],
        warnings: [],
        score: 90,
        scoreBreakdown: null,
        normalizedResult: null,
        providerMetadata: null,
        errorCategory: null,
      },
    ]);
    const evaluation = orchestrationRepo.evaluations[0]!;
    await orchestrationRepo.createSelectedOption({
      orchestrationRequestId: request.id,
      evaluationId: evaluation.id,
      providerId: evaluation.providerId,
      providerServiceId: null,
      providerCode: "MOCK_A",
      providerServiceCode: "MOCK_BIKE",
      score: 90,
      scoreBreakdown: {
        price: 100,
        eta: null,
        availability: null,
        providerPriority: 100,
        serviceQuality: null,
        applicableWeightSum: 50,
        rawWeightedScore: 45,
      },
      selectionReason: "Selected based on price.",
      quoteSnapshot: { amount: 150, currency: "INR" },
      availabilitySnapshot: { known: false },
      etaSnapshot: null,
      cancellationPolicySnapshot: defaultCancellationPolicySnapshot(),
    });

    const result = await buildService().orchestrate({
      deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-4",
    });

    expect(result.data.status).toBe("OPTION_READY");
    expect(evaluateMock).not.toHaveBeenCalled();
  });

  it("excludes provider with unknown cancellation policy from best option", async () => {
    const providerKnown = await seedOrchestrationMockProvider(providerRepo, {
      code: "MOCK_KNOWN",
      priority: 2,
    });
    const providerUnknown = await seedOrchestrationMockProvider(providerRepo, {
      code: "MOCK_UNKNOWN",
      priority: 1,
    });
    evaluateMock.mockImplementation(async ({ provider }) => {
      if (provider.code === "MOCK_UNKNOWN") {
        return {
          status: "INELIGIBLE",
          signals: {
            ...eligibleOutcome({
              providerId: providerUnknown,
              providerCode: "MOCK_UNKNOWN",
              amount: 90,
            }).signals,
            cancellationPolicy: {
              supported: false,
              allowedBeforePickup: false,
              allowedAfterPickup: false,
              fee: { type: "UNKNOWN" },
              conditions: [],
              policyKnown: false,
              source: "UNKNOWN",
            },
          },
          exclusionReasons: ["CANCELLATION_POLICY_UNKNOWN"],
          eligibilityReasons: [],
          errorCategory: null,
          score: null,
          scoreBreakdown: null,
        };
      }
      return eligibleOutcome({
        providerId: providerKnown,
        providerCode: "MOCK_KNOWN",
        amount: 150,
      });
    });

    const deliveryId = await createDelivery();
    const result = await buildService().orchestrate({
      deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-unknown-policy",
    });

    expect(result.data.orchestration.selectedOption?.providerCode).toBe(
      "MOCK_KNOWN",
    );
    expect(
      result.data.orchestration.selectedOption?.cancellationPolicy.policyKnown,
    ).toBe(true);
  });

  it("rejects orchestration for BOOKED deliveries", async () => {
    const deliveryId = await createDelivery();
    await deliveryRepo.transitionStatus({
      deliveryId,
      expectedFromStatuses: ["CREATED"],
      toStatus: "BOOKED",
      source: "BOOKING",
      reason: "test",
    });

    await expect(
      buildService().orchestrate({
        deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-5",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.DELIVERY_NOT_READY_FOR_ORCHESTRATION,
    });
  });
});
