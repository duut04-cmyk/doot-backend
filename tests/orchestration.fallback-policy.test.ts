import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config/env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config/env.js")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      ORCHESTRATION_MOCK_ONLY: false,
      ORCHESTRATION_PREFERRED_PROVIDER_CODE: "PREF_PROVIDER",
    },
  };
});

import { DeliveryService } from "../src/modules/delivery/delivery.service.js";
import * as orchestrationEligibility from "../src/modules/orchestration/orchestration.eligibility.js";
import { OrchestrationProviderEvaluationService } from "../src/modules/orchestration/orchestration.provider-evaluation.js";
import { OrchestrationService } from "../src/modules/orchestration/orchestration.service.js";
import type { ProviderEvaluationOutcome } from "../src/modules/orchestration/orchestration.types.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { knownFixedFeeCancellationPolicy } from "./helpers/cancellation-policy-test-helpers.js";
import { seedOrchestrationMockProvider } from "./helpers/provider-adapter-test-helpers.js";
import { phoneValue } from "./helpers/phone-test-helpers.js";
import { createTestRuntimeSettingsService } from "./helpers/test-runtime-settings.js";

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
        estimatedDeliveryMinutes: 60,
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

function errorOutcome(input: {
  providerId: string;
  providerCode: string;
  errorCategory: string;
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
    errorCategory: input.errorCategory,
    score: null,
    scoreBreakdown: null,
  };
}

describe("OrchestrationService fallback policy", () => {
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
      15_000,
      new InMemoryBookingRepository(),
      createTestRuntimeSettingsService(),
    );
  }

  it("selects fallback when preferred tier is INELIGIBLE", async () => {
    const preferredId = await seedOrchestrationMockProvider(providerRepo, {
      code: "PREF_PROVIDER",
      priority: 1,
    });
    const fallbackId = await seedOrchestrationMockProvider(providerRepo, {
      code: "FALLBACK_PROVIDER",
      priority: 2,
    });

    evaluateMock.mockImplementation(async ({ provider }) => {
      if (provider.code === "PREF_PROVIDER") {
        return {
          status: "INELIGIBLE",
          signals: eligibleOutcome({
            providerId: preferredId,
            providerCode: "PREF_PROVIDER",
            amount: 50,
          }).signals,
          exclusionReasons: ["ROUTE_NOT_SERVICEABLE"],
          eligibilityReasons: [],
          errorCategory: null,
          score: null,
          scoreBreakdown: null,
        };
      }
      return eligibleOutcome({
        providerId: fallbackId,
        providerCode: "FALLBACK_PROVIDER",
        amount: 120,
      });
    });

    const deliveryId = await createDelivery();
    const result = await buildService().orchestrate({
      deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-fallback-ineligible",
    });

    expect(result.data.status).toBe("OPTION_READY");
    expect(result.data.orchestration.selectedOption?.providerCode).toBe(
      "FALLBACK_PROVIDER",
    );
    expect(evaluateMock).toHaveBeenCalledTimes(2);
  });

  it("selects fallback when preferred tier has recoverable PROVIDER_TIMEOUT", async () => {
    const preferredId = await seedOrchestrationMockProvider(providerRepo, {
      code: "PREF_PROVIDER",
      priority: 1,
    });
    const fallbackId = await seedOrchestrationMockProvider(providerRepo, {
      code: "FALLBACK_PROVIDER",
      priority: 2,
    });

    evaluateMock.mockImplementation(async ({ provider }) => {
      if (provider.code === "PREF_PROVIDER") {
        return errorOutcome({
          providerId: preferredId,
          providerCode: "PREF_PROVIDER",
          errorCategory: "PROVIDER_TIMEOUT",
        });
      }
      return eligibleOutcome({
        providerId: fallbackId,
        providerCode: "FALLBACK_PROVIDER",
        amount: 99,
      });
    });

    const deliveryId = await createDelivery();
    const result = await buildService().orchestrate({
      deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-fallback-timeout",
    });

    expect(result.data.status).toBe("OPTION_READY");
    expect(result.data.orchestration.selectedOption?.providerCode).toBe(
      "FALLBACK_PROVIDER",
    );
  });

  it("does not run fallback when preferred tier has auth ERROR", async () => {
    const preferredId = await seedOrchestrationMockProvider(providerRepo, {
      code: "PREF_PROVIDER",
      priority: 1,
    });
    await seedOrchestrationMockProvider(providerRepo, {
      code: "FALLBACK_PROVIDER",
      priority: 2,
    });

    evaluateMock.mockImplementation(async ({ provider }) => {
      if (provider.code === "PREF_PROVIDER") {
        return errorOutcome({
          providerId: preferredId,
          providerCode: "PREF_PROVIDER",
          errorCategory: "PROVIDER_AUTHENTICATION_ERROR",
        });
      }
      return eligibleOutcome({
        providerId: "unused",
        providerCode: "FALLBACK_PROVIDER",
        amount: 80,
      });
    });

    const deliveryId = await createDelivery();
    const result = await buildService().orchestrate({
      deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-no-fallback-auth",
    });

    expect(result.data.status).toBe("FAILED");
    expect(evaluateMock).toHaveBeenCalledTimes(1);
  });

  it("does not evaluate fallback when preferred pre-check is INELIGIBLE and still allows fallback tier", async () => {
    const preferredId = await seedOrchestrationMockProvider(providerRepo, {
      code: "PREF_PROVIDER",
      priority: 1,
    });
    const fallbackId = await seedOrchestrationMockProvider(providerRepo, {
      code: "FALLBACK_PROVIDER",
      priority: 2,
    });

    evaluateMock.mockImplementation(async ({ provider }) => {
      if (provider.code === "PREF_PROVIDER") {
        return {
          status: "INELIGIBLE",
          signals: {
            ...eligibleOutcome({
              providerId: preferredId,
              providerCode: "PREF_PROVIDER",
              amount: 10,
            }).signals,
            compatibility: {
              weightCompatible: false,
              dimensionsCompatible: true,
              requirementsCompatible: true,
              scheduleCompatible: true,
            },
          },
          exclusionReasons: ["PACKAGE_WEIGHT_EXCEEDED"],
          eligibilityReasons: [],
          errorCategory: null,
          score: null,
          scoreBreakdown: null,
        };
      }
      return eligibleOutcome({
        providerId: fallbackId,
        providerCode: "FALLBACK_PROVIDER",
        amount: 140,
      });
    });

    const deliveryId = await createDelivery();
    const result = await buildService().orchestrate({
      deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-precheck-fallback",
    });

    expect(result.data.status).toBe("OPTION_READY");
    expect(result.data.orchestration.selectedOption?.providerCode).toBe(
      "FALLBACK_PROVIDER",
    );
    expect(evaluateMock).toHaveBeenCalledTimes(2);
  });
});
