import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { BookingService } from "../src/modules/booking/booking.service.js";
import { hashConfirmRequest } from "../src/modules/booking/booking.schema.js";
import { classifyProviderAdapterError } from "../src/modules/booking/booking.provider-outcome.js";
import { initializeProviderAdapters } from "../src/modules/provider/adapters/bootstrap.js";
import { ProviderAdapterExecutor } from "../src/modules/provider/adapters/provider-adapter-executor.js";
import { ProviderAdapterError } from "../src/modules/provider/contracts/provider-error.js";
import { seedOptionReadyDelivery } from "./helpers/booking-test-helpers.js";
import { knownFixedFeeCancellationPolicy } from "./helpers/cancellation-policy-test-helpers.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";

function configureExecuteMock(
  executeMock: ReturnType<typeof vi.fn>,
  handler: (input: { operation: string }) => Promise<unknown>,
) {
  executeMock.mockImplementation(async (input: { operation: string }) => {
    if (input.operation === "getCancellationPolicy") {
      return knownFixedFeeCancellationPolicy();
    }
    return handler(input);
  });
}

describe("Booking failure resilience", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let providerRepo: InMemoryProviderRepository;
  let orchestrationRepo: InMemoryOrchestrationRepository;
  let bookingRepo: InMemoryBookingRepository;
  let executeMock: ReturnType<typeof vi.fn>;
  let customerId: string;

  beforeEach(() => {
    initializeProviderAdapters();
    deliveryRepo = new InMemoryDeliveryRepository();
    providerRepo = new InMemoryProviderRepository();
    orchestrationRepo = new InMemoryOrchestrationRepository();
    bookingRepo = new InMemoryBookingRepository();
    executeMock = vi.fn();
    customerId = randomUUID();
  });

  function buildService() {
    return new BookingService(
      deliveryRepo,
      providerRepo,
      orchestrationRepo,
      bookingRepo,
      { execute: executeMock } as unknown as ProviderAdapterExecutor,
    );
  }

  it("marks booking FAILED and delivery FAILED on explicit provider rejection", async () => {
    configureExecuteMock(executeMock, async () => ({
      success: false,
      outcome: "FAILED",
      providerBookingId: null,
      providerReference: null,
      status: "REJECTED",
      bookedAt: null,
      estimatedPickupAt: null,
      estimatedDeliveryAt: null,
      trackingUrl: null,
      driver: null,
      service: null,
      reason: "Provider rejected booking.",
    }));

    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
    });

    await expect(
      buildService().confirm({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-book-fail-reject",
        requestHash: hashConfirmRequest(),
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.PROVIDER_BOOKING_REJECTED,
    });

    expect(bookingRepo.bookings[0]?.status).toBe("FAILED");
    expect(bookingRepo.bookings[0]?.unknownOutcome).not.toBe(true);
    const delivery = await deliveryRepo.findById(seeded.deliveryId);
    expect(delivery?.status).toBe("FAILED");
  });

  it("classifies rate-limited provider errors as UNKNOWN booking outcome", async () => {
    const resolved = classifyProviderAdapterError(
      new ProviderAdapterError({
        providerCode: "MOCK",
        operation: "createBooking",
        category: "PROVIDER_RATE_LIMITED",
        safeMessage: "Rate limited.",
      }),
    );

    expect(resolved.outcome).toBe("UNKNOWN");
    expect(resolved.failureCode).toBe(ErrorCodes.PROVIDER_BOOKING_UNKNOWN);
  });

  it("never reports BOOKED when adapter returns UNKNOWN outcome", async () => {
    configureExecuteMock(executeMock, async () => ({
      success: false,
      outcome: "UNKNOWN",
      providerBookingId: null,
      providerReference: null,
      status: "UNKNOWN",
      bookedAt: null,
      estimatedPickupAt: null,
      estimatedDeliveryAt: null,
      trackingUrl: null,
      driver: null,
      service: null,
      reason: "Outcome uncertain.",
    }));

    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
    });

    await expect(
      buildService().confirm({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-book-fail-unknown",
        requestHash: hashConfirmRequest(),
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.BOOKING_UNKNOWN,
    });

    expect(bookingRepo.bookings[0]?.status).toBe("UNKNOWN");
    expect(bookingRepo.bookings[0]?.unknownOutcome).toBe(true);
    const delivery = await deliveryRepo.findById(seeded.deliveryId);
    expect(delivery?.status).toBe("BOOKING");
  });

  it("blocks duplicate confirm while booking is in progress", async () => {
    configureExecuteMock(
      executeMock,
      async () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                success: true,
                outcome: "BOOKED",
                providerBookingId: "PO-SLOW",
                providerReference: "REF-SLOW",
                status: "CONFIRMED",
                bookedAt: new Date().toISOString(),
                estimatedPickupAt: null,
                estimatedDeliveryAt: null,
                trackingUrl: null,
                driver: null,
                service: null,
                reason: null,
                amount: { amount: 150, currency: "INR" },
              }),
            50,
          );
        }),
    );

    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
    });

    const service = buildService();
    const first = service.confirm({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-book-in-progress-1",
      requestHash: hashConfirmRequest(),
    });

    await expect(
      service.confirm({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-book-in-progress-2",
        requestHash: hashConfirmRequest(),
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.BOOKING_IN_PROGRESS,
    });

    await first;
  });
});
