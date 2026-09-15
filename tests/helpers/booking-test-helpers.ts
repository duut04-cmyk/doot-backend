import { randomUUID } from "node:crypto";
import { storedPhone } from "./phone-test-helpers.js";
import type { InMemoryDeliveryRepository } from "./in-memory-delivery-repository.js";
import type { InMemoryOrchestrationRepository } from "./in-memory-orchestration-repository.js";
import type { InMemoryProviderRepository } from "./in-memory-provider-repository.js";
import { seedOrchestrationMockProvider } from "./provider-adapter-test-helpers.js";

export async function seedOptionReadyDelivery(input: {
  deliveryRepo: InMemoryDeliveryRepository;
  orchestrationRepo: InMemoryOrchestrationRepository;
  providerRepo: InMemoryProviderRepository;
  customerId: string;
  providerCode?: string;
  quoteAmount?: number;
  quoteSnapshot?: Record<string, unknown>;
}) {
  const providerId = await seedOrchestrationMockProvider(input.providerRepo, {
    code: input.providerCode ?? "MOCK",
    priority: 1,
  });
  const provider = await input.providerRepo.findById(providerId);
  const service = provider?.services[0];

  const reference = await input.deliveryRepo.nextReference();
  const delivery = await input.deliveryRepo.createDelivery({
    customerId: input.customerId,
    reference,
    pickup: {
      addressText: "Pickup",
      contactName: "A",
      ...storedPhone("+91", "9876543210"),
      instructions: null,
    },
    drop: {
      addressText: "Drop",
      contactName: "B",
      ...storedPhone("+91", "9811122233"),
      instructions: null,
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
    compliance: { accepted: true, acceptedAt: new Date() },
  });

  await input.deliveryRepo.transitionStatus({
    deliveryId: delivery.id,
    expectedFromStatuses: ["CREATED"],
    toStatus: "ORCHESTRATING",
    source: "ORCHESTRATION",
    reason: "test",
  });
  await input.deliveryRepo.transitionStatus({
    deliveryId: delivery.id,
    expectedFromStatuses: ["ORCHESTRATING"],
    toStatus: "OPTION_READY",
    source: "ORCHESTRATION",
    reason: "test",
  });

  const request = await input.orchestrationRepo.createRequest({
    deliveryId: delivery.id,
    requestedByUserId: input.customerId,
    attemptNumber: 1,
  });
  await input.orchestrationRepo.completeRequest({
    requestId: request.id,
    status: "COMPLETED",
  });

  const evaluation = await input.orchestrationRepo.createEvaluations([
    {
      orchestrationRequestId: request.id,
      providerId,
      providerServiceId: service?.id ?? null,
      providerCode: input.providerCode ?? "MOCK",
      providerServiceCode: service?.code ?? "MOCK_BIKE",
      status: "ELIGIBLE",
      serviceable: true,
      availabilityKnown: false,
      available: null,
      availableDriverCount: null,
      quoteAvailable: true,
      quoteAmount: input.quoteAmount ?? 150,
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

  const selectedOption = await input.orchestrationRepo.createSelectedOption({
    orchestrationRequestId: request.id,
    evaluationId: evaluation[0]!.id,
    providerId,
    providerServiceId: service?.id ?? null,
    providerCode: input.providerCode ?? "MOCK",
    providerServiceCode: service?.code ?? "MOCK_BIKE",
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
    quoteSnapshot: input.quoteSnapshot ?? {
      amount: input.quoteAmount ?? 150,
      currency: "INR",
      providerQuoteId: "Q1",
      quotedAt: new Date().toISOString(),
    },
    availabilitySnapshot: { known: false },
    etaSnapshot: null,
  });

  return {
    deliveryId: delivery.id,
    deliveryReference: delivery.reference,
    providerId,
    orchestrationRequestId: request.id,
    selectedOptionId: selectedOption.id,
  };
}

export function randomCustomerId() {
  return randomUUID();
}
