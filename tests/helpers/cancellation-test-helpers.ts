import { storedPhone } from "./phone-test-helpers.js";
import type { InMemoryDeliveryRepository } from "./in-memory-delivery-repository.js";

export async function seedCreatedDelivery(input: {
  deliveryRepo: InMemoryDeliveryRepository;
  customerId: string;
}) {
  const reference = await input.deliveryRepo.nextReference();
  const delivery = await input.deliveryRepo.createDelivery({
    customerId: input.customerId,
    reference,
    pickup: {
      addressText: "Pickup",
      contactName: "A",
      ...storedPhone("+91", "9876543210"),
      instructions: null,
      latitude: null,
      longitude: null,
    },
    drop: {
      addressText: "Drop",
      contactName: "B",
      ...storedPhone("+91", "9811122233"),
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
    compliance: { accepted: true, acceptedAt: new Date() },
  });

  return {
    deliveryId: delivery.id,
    deliveryReference: delivery.reference,
  };
}

export async function seedOrchestratingDelivery(input: {
  deliveryRepo: InMemoryDeliveryRepository;
  customerId: string;
}) {
  const seeded = await seedCreatedDelivery(input);
  await input.deliveryRepo.transitionStatus({
    deliveryId: seeded.deliveryId,
    expectedFromStatuses: ["CREATED"],
    toStatus: "ORCHESTRATING",
    source: "ORCHESTRATION",
    reason: "test",
  });
  return seeded;
}
