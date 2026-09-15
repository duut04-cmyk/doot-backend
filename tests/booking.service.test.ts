import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { BookingService } from "../src/modules/booking/booking.service.js";
import { hashConfirmRequest } from "../src/modules/booking/booking.schema.js";
import { DeliveryService } from "../src/modules/delivery/delivery.service.js";
import { initializeProviderAdapters } from "../src/modules/provider/adapters/bootstrap.js";
import { ProviderAdapterExecutor } from "../src/modules/provider/adapters/provider-adapter-executor.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { seedOptionReadyDelivery } from "./helpers/booking-test-helpers.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";

describe("BookingService", () => {
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function buildService() {
    const executor = {
      execute: executeMock,
    } as unknown as ProviderAdapterExecutor;
    return new BookingService(
      deliveryRepo,
      providerRepo,
      orchestrationRepo,
      bookingRepo,
      executor,
    );
  }

  it("confirms OPTION_READY delivery and transitions to BOOKED", async () => {
    executeMock.mockResolvedValue({
      success: true,
      outcome: "BOOKED",
      providerBookingId: "PO-100",
      providerReference: "REF-100",
      status: "CONFIRMED",
      bookedAt: new Date().toISOString(),
      estimatedPickupAt: null,
      estimatedDeliveryAt: null,
      trackingUrl: null,
      driver: null,
      service: null,
      reason: null,
      amount: { amount: 150, currency: "INR" },
    });

    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
    });

    const result = await buildService().confirm({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-book-1",
      requestHash: hashConfirmRequest(),
    });

    expect(result.data.delivery.status).toBe("BOOKED");
    expect(result.data.booking.status).toBe("BOOKED");
    expect(result.data.booking.providerReference).toBeTruthy();
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0]?.[0]?.operation).toBe("createBooking");

    const delivery = await deliveryRepo.findById(seeded.deliveryId);
    expect(delivery?.status).toBe("BOOKED");
    expect(bookingRepo.bookings).toHaveLength(1);
    expect(bookingRepo.bookings[0]?.providerOrderId).toBe("PO-100");
  });

  it("rejects confirmation when delivery is CREATED", async () => {
    const deliveryService = new DeliveryService(deliveryRepo);
    const created = await deliveryService.createDelivery({
      customerId,
      body: {
        pickup: {
          addressText: "Pickup",
          contactName: "A",
          contactPhone: "+919876543210",
        },
        drop: {
          addressText: "Drop",
          contactName: "B",
          contactPhone: "+919811122233",
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

    await expect(
      buildService().confirm({
        deliveryId: created.data.id,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-book-2",
        requestHash: hashConfirmRequest(),
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.BOOKING_NOT_ALLOWED });
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("returns existing booking when delivery is already BOOKED", async () => {
    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
    });
    await deliveryRepo.transitionStatus({
      deliveryId: seeded.deliveryId,
      expectedFromStatuses: ["OPTION_READY"],
      toStatus: "BOOKING",
      source: "BOOKING",
      reason: "test",
    });
    await bookingRepo.createBookingAttempt({
      deliveryId: seeded.deliveryId,
      attemptNumber: 1,
      orchestrationRequestId: seeded.orchestrationRequestId,
      orchestrationOptionId: seeded.selectedOptionId,
      providerId: seeded.providerId,
      providerServiceId: null,
      providerCode: "MOCK",
      providerServiceCode: "MOCK_BIKE",
      correlationReference: "DUTT-TEST-BOOKING-1",
      quotedAmount: 150,
      quotedCurrency: "INR",
      providerQuoteId: "Q1",
      quoteSnapshot: { amount: 150, currency: "INR" },
      requestId: "req-old",
    });
    await bookingRepo.finalizeBooking({
      bookingId: bookingRepo.bookings[0]!.id,
      status: "BOOKED",
      providerOrderId: "PO-EXISTING",
      bookedAmount: 150,
      bookedCurrency: "INR",
      bookedAt: new Date(),
    });
    await deliveryRepo.transitionStatus({
      deliveryId: seeded.deliveryId,
      expectedFromStatuses: ["BOOKING"],
      toStatus: "BOOKED",
      source: "BOOKING",
      reason: "test",
    });

    const result = await buildService().confirm({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-book-3",
      requestHash: hashConfirmRequest(),
    });

    expect(result.data.booking.status).toBe("BOOKED");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("marks booking UNKNOWN and keeps delivery BOOKING on provider timeout", async () => {
    executeMock.mockRejectedValue(
      Object.assign(new Error("timeout"), {
        name: "ProviderAdapterError",
      }),
    );
    executeMock.mockImplementation(async () => {
      const { ProviderAdapterError } = await import(
        "../src/modules/provider/contracts/provider-error.js"
      );
      throw new ProviderAdapterError({
        providerCode: "MOCK",
        operation: "createBooking",
        category: "PROVIDER_TIMEOUT",
        safeMessage: "Timed out.",
      });
    });

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
        requestId: "req-book-4",
        requestHash: hashConfirmRequest(),
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.BOOKING_UNKNOWN });

    const delivery = await deliveryRepo.findById(seeded.deliveryId);
    expect(delivery?.status).toBe("BOOKING");
    expect(bookingRepo.bookings[0]?.status).toBe("UNKNOWN");
    expect(bookingRepo.bookings[0]?.unknownOutcome).toBe(true);
  });

  it("blocks retry after UNKNOWN booking", async () => {
    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
    });
    await deliveryRepo.transitionStatus({
      deliveryId: seeded.deliveryId,
      expectedFromStatuses: ["OPTION_READY"],
      toStatus: "BOOKING",
      source: "BOOKING",
      reason: "test",
    });
    await bookingRepo.createBookingAttempt({
      deliveryId: seeded.deliveryId,
      attemptNumber: 1,
      orchestrationRequestId: seeded.orchestrationRequestId,
      orchestrationOptionId: seeded.selectedOptionId,
      providerId: seeded.providerId,
      providerServiceId: null,
      providerCode: "MOCK",
      providerServiceCode: "MOCK_BIKE",
      correlationReference: "DUTT-TEST-BOOKING-1",
      quotedAmount: 150,
      quotedCurrency: "INR",
      providerQuoteId: "Q1",
      quoteSnapshot: { amount: 150, currency: "INR" },
      requestId: "req-old",
    });
    await bookingRepo.finalizeBooking({
      bookingId: bookingRepo.bookings[0]!.id,
      status: "UNKNOWN",
      unknownOutcome: true,
      failureCode: ErrorCodes.PROVIDER_BOOKING_UNKNOWN,
      failureMessage: "Unknown",
    });

    await expect(
      buildService().confirm({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-book-5",
        requestHash: hashConfirmRequest(),
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.PROVIDER_BOOKING_RECONCILIATION_REQUIRED,
    });
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("returns 409 BOOKING_OPTION_CHANGED when requote price differs", async () => {
    executeMock.mockImplementation(async (input: { operation: string }) => {
      if (input.operation === "getQuote") {
        return {
          available: true,
          amount: { amount: 999, currency: "INR" },
          providerQuoteId: "Q2",
          estimatedDeliveryAt: null,
          estimatedDeliveryMinutes: 30,
          breakdown: null,
          quotedAt: new Date().toISOString(),
          reason: null,
        };
      }
      throw new Error("createBooking should not be called");
    });

    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
      quoteSnapshot: {
        amount: 150,
        currency: "INR",
        providerQuoteId: "Q1",
        quotedAt: new Date(Date.now() - 600_000).toISOString(),
      },
    });

    await expect(
      buildService().confirm({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-book-6",
        requestHash: hashConfirmRequest(),
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.BOOKING_OPTION_CHANGED });
  });

  it("stores idempotency and returns cached response on repeat", async () => {
    executeMock.mockResolvedValue({
      success: true,
      outcome: "BOOKED",
      providerBookingId: "PO-IDEM",
      providerReference: "REF-IDEM",
      status: "CONFIRMED",
      bookedAt: new Date().toISOString(),
      estimatedPickupAt: null,
      estimatedDeliveryAt: null,
      trackingUrl: null,
      driver: null,
      service: null,
      reason: null,
      amount: { amount: 150, currency: "INR" },
    });

    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
    });
    const service = buildService();
    const key = randomUUID();

    await service.confirm({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-book-7",
      idempotencyKey: key,
      requestHash: hashConfirmRequest(),
    });

    const cached = await service.confirm({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-book-8",
      idempotencyKey: key,
      requestHash: hashConfirmRequest(),
    });

    expect(cached.data.booking.status).toBe("BOOKED");
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("hides cross-customer delivery with 404", async () => {
    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
    });

    await expect(
      buildService().confirm({
        deliveryId: seeded.deliveryId,
        userId: randomUUID(),
        role: "CUSTOMER",
        requestId: "req-book-9",
        requestHash: hashConfirmRequest(),
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.DELIVERY_NOT_FOUND });
  });
});
