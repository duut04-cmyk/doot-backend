import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config/env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config/env.js")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      SHIPROCKET_ENABLED: true,
      SHIPROCKET_BOOKING_ENABLED: true,
      SHIPROCKET_PICKUP_LOCATION: "Doot Test Pickup",
    },
  };
});
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { BookingService } from "../src/modules/booking/booking.service.js";
import { hashConfirmRequest } from "../src/modules/booking/booking.schema.js";
import { OperationalRefreshService } from "../src/modules/operations/operational-refresh.service.js";
import { ProviderAdapterExecutor } from "../src/modules/provider/adapters/provider-adapter-executor.js";
import { initializeProviderAdapters } from "../src/modules/provider/adapters/bootstrap.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import {
  seedOptionReadyDelivery,
  seedPaidPayment,
} from "./helpers/booking-test-helpers.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryPaymentRepository } from "./helpers/in-memory-payment-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { enrichQuoteSnapshotWithCustomerPricing } from "../src/modules/pricing/customer-delivery-pricing.js";

describe("Shiprocket booking integration (service workflows)", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let providerRepo: InMemoryProviderRepository;
  let orchestrationRepo: InMemoryOrchestrationRepository;
  let bookingRepo: InMemoryBookingRepository;
  let paymentRepo: InMemoryPaymentRepository;
  let executeMock: ReturnType<typeof vi.fn>;
  let customerId: string;

  beforeEach(() => {
    initializeProviderAdapters();
    deliveryRepo = new InMemoryDeliveryRepository();
    providerRepo = new InMemoryProviderRepository();
    orchestrationRepo = new InMemoryOrchestrationRepository();
    bookingRepo = new InMemoryBookingRepository();
    paymentRepo = new InMemoryPaymentRepository();
    executeMock = vi.fn();
    customerId = randomUUID();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function buildBookingService() {
    const executor = { execute: executeMock } as unknown as ProviderAdapterExecutor;
    return new BookingService(
      deliveryRepo,
      providerRepo,
      orchestrationRepo,
      bookingRepo,
      executor,
      paymentRepo,
    );
  }

  it("persists provider metadata on UNKNOWN AWB failure and reconciles to BOOKED on retry", async () => {
    executeMock.mockImplementation(async (input: { operation: string }) => {
      if (input.operation === "getCancellationPolicy") {
        return {
          policyKnown: true,
          cancellable: true,
          feeKnown: true,
          feeAmount: { amount: 0, currency: "INR" },
          feePercent: null,
          windowKnown: false,
          cancellableUntil: null,
          reason: null,
        };
      }
      if (input.operation === "createBooking") {
        return {
          success: false,
          outcome: "UNKNOWN",
          providerBookingId: "SR-ORDER-1",
          providerReference: "999888",
          status: "NEW",
          bookedAt: null,
          estimatedPickupAt: null,
          estimatedDeliveryAt: null,
          trackingUrl: null,
          driver: null,
          service: null,
          reason: "AWB assignment failed.",
          metadata: { shiprocketShipmentId: "999888" },
        };
      }
      if (input.operation === "getBooking") {
        return {
          success: true,
          outcome: "BOOKED",
          providerBookingId: "SR-ORDER-1",
          providerReference: "999888",
          status: "READY",
          bookedAt: new Date().toISOString(),
          estimatedPickupAt: null,
          estimatedDeliveryAt: null,
          trackingUrl: null,
          driver: null,
          service: null,
          reason: null,
          metadata: {
            shiprocketAwbCode: "AWB999888",
            shiprocketShipmentId: "999888",
          },
        };
      }
      throw new Error(`Unexpected operation ${input.operation}`);
    });

    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
      providerCode: "SHIPROCKET",
    });
    await seedPaidPayment({ paymentRepo, deliveryId: seeded.deliveryId, customerId });

    await expect(
      buildBookingService().confirm({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-sr-1",
        requestHash: hashConfirmRequest(),
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.BOOKING_UNKNOWN });

    const unknownBooking = bookingRepo.bookings[0]!;
    expect(unknownBooking.status).toBe("UNKNOWN");
    expect(unknownBooking.providerOrderId).toBe("SR-ORDER-1");
    expect(unknownBooking.quoteSnapshot.providerMetadata?.shiprocketShipmentId).toBe(
      "999888",
    );
    expect(
      unknownBooking.quoteSnapshot.providerMetadata?.shiprocketAwbCode,
    ).toBeUndefined();

    executeMock.mockClear();

    const reconciled = await buildBookingService().confirm({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-sr-2",
      requestHash: hashConfirmRequest(),
    });

    expect(reconciled.data.booking.status).toBe("BOOKED");
    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "getBooking", providerCode: "SHIPROCKET" }),
    );
    const delivery = await deliveryRepo.findById(seeded.deliveryId);
    expect(delivery?.status).toBe("BOOKED");
  });

  it("does not reconcile UNKNOWN to BOOKED when only shipment id is stored", async () => {
    executeMock.mockImplementation(async (input: { operation: string }) => {
      if (input.operation === "getCancellationPolicy") {
        return {
          policyKnown: true,
          cancellable: true,
          feeKnown: true,
          feeAmount: { amount: 0, currency: "INR" },
          feePercent: null,
          windowKnown: false,
          cancellableUntil: null,
          reason: null,
        };
      }
      if (input.operation === "getBooking") {
        return {
          success: true,
          outcome: "BOOKED",
          providerBookingId: "SR-ORDER-X",
          providerReference: "888777",
          status: "NEW",
          bookedAt: null,
          estimatedPickupAt: null,
          estimatedDeliveryAt: null,
          trackingUrl: null,
          driver: null,
          service: null,
          reason: null,
          metadata: { shiprocketShipmentId: "888777" },
        };
      }
      throw new Error(`Unexpected operation ${input.operation}`);
    });

    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
      providerCode: "SHIPROCKET",
    });
    await seedPaidPayment({ paymentRepo, deliveryId: seeded.deliveryId, customerId });
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
      providerCode: "SHIPROCKET",
      providerServiceCode: "MOCK_BIKE",
      correlationReference: "DUTT-TEST-BOOKING-SHIPONLY",
      quotedAmount: 150,
      quotedCurrency: "INR",
      providerQuoteId: "Q1",
      quoteSnapshot: {
        amount: 150,
        currency: "INR",
        providerMetadata: { shiprocketShipmentId: "888777" },
      },
      requestId: "req-ship-only",
    });
    await bookingRepo.finalizeBooking({
      bookingId: bookingRepo.bookings[0]!.id,
      status: "UNKNOWN",
      providerOrderId: "SR-ORDER-X",
      providerReference: "888777",
      unknownOutcome: true,
      failureCode: ErrorCodes.PROVIDER_BOOKING_UNKNOWN,
      failureMessage: "AWB pending",
    });

    await expect(
      buildBookingService().confirm({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-ship-only-retry",
        requestHash: hashConfirmRequest(),
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.PROVIDER_BOOKING_RECONCILIATION_REQUIRED,
    });
  });

  it("persists channel order id when createBooking times out at the adapter", async () => {
    executeMock.mockImplementation(async (input: { operation: string }) => {
      if (input.operation === "getCancellationPolicy") {
        return {
          policyKnown: true,
          cancellable: true,
          feeKnown: true,
          feeAmount: { amount: 0, currency: "INR" },
          feePercent: null,
          windowKnown: false,
          cancellableUntil: null,
          reason: null,
        };
      }
      if (input.operation === "createBooking") {
        const { ProviderAdapterError } =
          await import("../src/modules/provider/contracts/provider-error.js");
        throw new ProviderAdapterError({
          providerCode: "SHIPROCKET",
          operation: "createBooking",
          category: "PROVIDER_TIMEOUT",
          safeMessage: "Timed out.",
        });
      }
      throw new Error(`Unexpected operation ${input.operation}`);
    });

    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
      providerCode: "SHIPROCKET",
    });
    await seedPaidPayment({ paymentRepo, deliveryId: seeded.deliveryId, customerId });

    await expect(
      buildBookingService().confirm({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-sr-timeout",
        requestHash: hashConfirmRequest(),
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.BOOKING_UNKNOWN });

    const booking = bookingRepo.bookings[0]!;
    expect(booking.status).toBe("UNKNOWN");
    expect(booking.providerOrderId).toBe(seeded.deliveryReference);
    expect(booking.quoteSnapshot.providerMetadata?.shiprocketChannelOrderId).toBe(
      seeded.deliveryReference,
    );
  });

  it("blocks UNKNOWN retry when provider order id and reconciliation metadata are missing", async () => {
    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
    });
    await seedPaidPayment({ paymentRepo, deliveryId: seeded.deliveryId, customerId });
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
      providerCode: "SHIPROCKET",
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
      buildBookingService().confirm({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-sr-3",
        requestHash: hashConfirmRequest(),
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.PROVIDER_BOOKING_RECONCILIATION_REQUIRED,
    });
  });

  it("reconciles UNKNOWN via getBooking when AWB appears at provider", async () => {
    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
      providerCode: "SHIPROCKET",
    });
    await seedPaidPayment({ paymentRepo, deliveryId: seeded.deliveryId, customerId });
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
      providerCode: "SHIPROCKET",
      providerServiceCode: "MOCK_BIKE",
      correlationReference: "DUTT-TEST-BOOKING-2",
      quotedAmount: 150,
      quotedCurrency: "INR",
      providerQuoteId: "Q1",
      quoteSnapshot: enrichQuoteSnapshotWithCustomerPricing(
        {
          amount: 150,
          currency: "INR",
          providerQuoteId: "Q1",
        },
        10,
      ),
      requestId: "req-old",
    });
    await bookingRepo.finalizeBooking({
      bookingId: bookingRepo.bookings[0]!.id,
      status: "UNKNOWN",
      providerOrderId: "SR-ORDER-2",
      providerReference: "777666",
      unknownOutcome: true,
      failureCode: ErrorCodes.PROVIDER_BOOKING_UNKNOWN,
      failureMessage: "AWB pending",
    });

    executeMock.mockImplementation(async (input: { operation: string }) => {
      if (input.operation === "getBooking") {
        return {
          success: true,
          outcome: "BOOKED",
          providerBookingId: "SR-ORDER-2",
          providerReference: "777666",
          status: "READY",
          bookedAt: new Date().toISOString(),
          estimatedPickupAt: null,
          estimatedDeliveryAt: null,
          trackingUrl: null,
          driver: null,
          service: null,
          reason: null,
          metadata: { shiprocketAwbCode: "AWB123" },
        };
      }
      throw new Error(`Unexpected ${input.operation}`);
    });

    const result = await buildBookingService().confirm({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-sr-4",
      requestHash: hashConfirmRequest(),
    });

    expect(result.data.booking.status).toBe("BOOKED");
    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "getBooking", providerCode: "SHIPROCKET" }),
    );
    expect(
      bookingRepo.bookings[0]?.quoteSnapshot.providerMetadata?.shiprocketAwbCode,
    ).toBe("AWB123");
  });

  it("operational refresh invokes getTracking for BOOKED Shiprocket booking", async () => {
    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
      providerCode: "SHIPROCKET",
    });
    await deliveryRepo.transitionStatus({
      deliveryId: seeded.deliveryId,
      expectedFromStatuses: ["OPTION_READY"],
      toStatus: "BOOKED",
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
      providerCode: "SHIPROCKET",
      providerServiceCode: "MOCK_BIKE",
      correlationReference: "DUTT-TEST-BOOKING-3",
      quotedAmount: 150,
      quotedCurrency: "INR",
      providerQuoteId: "Q1",
      quoteSnapshot: { amount: 150, currency: "INR" },
      requestId: "req-old",
    });
    await bookingRepo.finalizeBooking({
      bookingId: bookingRepo.bookings[0]!.id,
      status: "BOOKED",
      providerOrderId: "SR-ORDER-3",
      providerReference: "555444",
      bookedAt: new Date(),
    });

    executeMock.mockResolvedValue({
      status: "IN_TRANSIT",
      latitude: 12.9,
      longitude: 77.6,
      accuracyMeters: null,
      providerTimestamp: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      eta: null,
      trackingUrl: null,
      driver: null,
      providerEventId: "evt-1",
    });

    const driverMock = { ingestFromPoll: vi.fn().mockResolvedValue(null) };
    const trackingMock = { ingestFromPoll: vi.fn().mockResolvedValue({ id: "tp-1" }) };
    const refresh = new OperationalRefreshService(deliveryRepo, bookingRepo, {
      execute: executeMock,
    } as unknown as ProviderAdapterExecutor);
    refresh.configure({
      driver: driverMock as never,
      tracking: trackingMock as never,
    });

    await refresh.refreshFromProvider({
      deliveryId: seeded.deliveryId,
      requestId: "poll-1",
      source: "OPERATIONAL_POLLING",
      failureMode: "log",
    });

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "getTracking",
        providerCode: "SHIPROCKET",
        payload: expect.objectContaining({ providerBookingId: "SR-ORDER-3" }),
      }),
    );
  });
});
