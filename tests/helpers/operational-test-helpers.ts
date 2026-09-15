import { MOCK_BOOKING_ID } from "../../src/modules/provider/adapters/mock/mock-provider.constants.js";
import type { InMemoryBookingRepository } from "./in-memory-booking-repository.js";
import { seedOptionReadyDelivery } from "./booking-test-helpers.js";
import type { InMemoryDeliveryRepository } from "./in-memory-delivery-repository.js";
import type { InMemoryOrchestrationRepository } from "./in-memory-orchestration-repository.js";
import type { InMemoryProviderRepository } from "./in-memory-provider-repository.js";

export async function seedBookedDelivery(input: {
  deliveryRepo: InMemoryDeliveryRepository;
  orchestrationRepo: InMemoryOrchestrationRepository;
  providerRepo: InMemoryProviderRepository;
  bookingRepo: InMemoryBookingRepository;
  customerId: string;
  providerOrderId?: string;
}) {
  const seeded = await seedOptionReadyDelivery({
    deliveryRepo: input.deliveryRepo,
    orchestrationRepo: input.orchestrationRepo,
    providerRepo: input.providerRepo,
    customerId: input.customerId,
  });

  await input.deliveryRepo.transitionStatus({
    deliveryId: seeded.deliveryId,
    expectedFromStatuses: ["OPTION_READY"],
    toStatus: "BOOKING",
    source: "BOOKING",
    reason: "test booking started",
  });

  const providerOrderId = input.providerOrderId ?? MOCK_BOOKING_ID;
  const booking = await input.bookingRepo.createBookingAttempt({
    deliveryId: seeded.deliveryId,
    attemptNumber: 1,
    orchestrationRequestId: seeded.orchestrationRequestId,
    orchestrationOptionId: seeded.selectedOptionId,
    providerId: seeded.providerId,
    providerServiceId: null,
    providerCode: "MOCK",
    providerServiceCode: "MOCK_BIKE",
    correlationReference: `${seeded.deliveryReference}-BOOKING-1`,
    quotedAmount: 150,
    quotedCurrency: "INR",
    providerQuoteId: "Q1",
    quoteSnapshot: { amount: 150, currency: "INR", quotedAt: new Date().toISOString() },
    requestId: "test-request",
  });

  await input.bookingRepo.finalizeBooking({
    bookingId: booking.id,
    status: "BOOKED",
    providerOrderId,
    providerReference: "REF-1",
    bookedAmount: 150,
    bookedCurrency: "INR",
    bookedAt: new Date(),
  });

  await input.deliveryRepo.transitionStatus({
    deliveryId: seeded.deliveryId,
    expectedFromStatuses: ["BOOKING"],
    toStatus: "BOOKED",
    source: "BOOKING",
    reason: "test booking completed",
  });

  return {
    ...seeded,
    bookingId: booking.id,
    providerOrderId,
  };
}

export async function seedDeliveredDelivery(input: {
  deliveryRepo: InMemoryDeliveryRepository;
  orchestrationRepo: InMemoryOrchestrationRepository;
  providerRepo: InMemoryProviderRepository;
  bookingRepo: InMemoryBookingRepository;
  customerId: string;
  providerOrderId?: string;
}) {
  const seeded = await seedBookedDelivery(input);
  await input.deliveryRepo.transitionStatus({
    deliveryId: seeded.deliveryId,
    expectedFromStatuses: ["BOOKED"],
    toStatus: "DELIVERED",
    source: "OTP",
    reason: "test delivery completed",
  });
  return seeded;
}
