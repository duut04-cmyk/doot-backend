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

  function mockCancellationPolicy() {
    return {
      policyKnown: true,
      cancellable: true,
      feeKnown: true,
      feeAmount: { amount: 0, currency: "INR" as const },
      feePercent: null,
      windowKnown: false,
      cancellableUntil: null,
      reason: null,
    };
  }

  function mockShiprocketBookedAdapterResult(overrides?: {
    providerBookingId?: string;
    awb?: string;
    shipmentId?: string;
  }) {
    const providerBookingId = overrides?.providerBookingId ?? "16161616";
    const awb = overrides?.awb ?? "SR123456789IN";
    const shipmentId = overrides?.shipmentId ?? "15151515";
    return {
      success: true,
      outcome: "BOOKED" as const,
      providerBookingId,
      providerReference: shipmentId,
      status: "READY",
      bookedAt: new Date().toISOString(),
      estimatedPickupAt: null,
      estimatedDeliveryAt: null,
      trackingUrl: null,
      driver: null,
      service: { serviceCode: "MOCK_BIKE", serviceName: null, vehicleType: null },
      reason: null,
      amount: { amount: 150, currency: "INR" as const },
      metadata: {
        shiprocketOrderId: providerBookingId,
        shiprocketShipmentId: shipmentId,
        shiprocketAwbCode: awb,
        shiprocketCourierId: 101,
        shiprocketChannelOrderId: "channel-ref",
      },
    };
  }

  function configureShiprocketBookedExecuteMock() {
    executeMock.mockImplementation(async (input: { operation: string }) => {
      if (input.operation === "getCancellationPolicy") {
        return mockCancellationPolicy();
      }
      if (input.operation === "createBooking") {
        return mockShiprocketBookedAdapterResult();
      }
      throw new Error(`Unexpected operation ${input.operation}`);
    });
  }

  function shiprocketOrchestrationQuoteSnapshot() {
    return enrichQuoteSnapshotWithCustomerPricing(
      {
        amount: 150,
        currency: "INR",
        providerQuoteId: "101",
        quotedAt: new Date().toISOString(),
        providerMetadata: {
          shiprocketHyperlocalRate: {
            courier_company_id: 101,
            rates: 150,
          },
          shiprocketPickupPostcode: "110030",
          shiprocketDeliveryPostcode: "122002",
        },
      },
      10,
    );
  }

  it("confirms PAID Shiprocket delivery to BOOKED with AWB metadata persisted", async () => {
    configureShiprocketBookedExecuteMock();

    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
      providerCode: "SHIPROCKET",
      quoteSnapshot: shiprocketOrchestrationQuoteSnapshot(),
    });
    await seedPaidPayment({ paymentRepo, deliveryId: seeded.deliveryId, customerId });

    const result = await buildBookingService().confirm({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "ADMIN",
      requestId: "req-sr-booked",
      requestHash: hashConfirmRequest(),
    });

    expect(result.data.delivery.status).toBe("BOOKED");
    expect(result.data.booking.status).toBe("BOOKED");
    expect(result.data.booking.providerCode).toBe("SHIPROCKET");
    expect(result.data.booking.providerOrderId).toBe("16161616");
    expect(result.data.booking.providerReference).toBe("15151515");

    expect(bookingRepo.bookings).toHaveLength(1);
    const persisted = bookingRepo.bookings[0]!;
    expect(persisted.deliveryId).toBe(seeded.deliveryId);
    expect(persisted.providerId).toBe(seeded.providerId);
    expect(persisted.status).toBe("BOOKED");
    expect(persisted.quoteSnapshot.providerMetadata?.shiprocketAwbCode).toBe(
      "SR123456789IN",
    );
    expect(persisted.quoteSnapshot.providerMetadata?.shiprocketOrderId).toBe(
      "16161616",
    );

    const createCalls = executeMock.mock.calls.filter(
      (call) => call[0]?.operation === "createBooking",
    );
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]?.[0]).toMatchObject({
      providerCode: "SHIPROCKET",
      operation: "createBooking",
    });
  });

  it("returns existing BOOKED result on repeat confirm without a second createBooking", async () => {
    configureShiprocketBookedExecuteMock();

    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
      providerCode: "SHIPROCKET",
      quoteSnapshot: shiprocketOrchestrationQuoteSnapshot(),
    });
    await seedPaidPayment({ paymentRepo, deliveryId: seeded.deliveryId, customerId });

    const service = buildBookingService();
    await service.confirm({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-sr-first",
      requestHash: hashConfirmRequest(),
    });

    executeMock.mockClear();

    const second = await service.confirm({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-sr-second",
      requestHash: hashConfirmRequest(),
    });

    expect(second.data.booking.status).toBe("BOOKED");
    expect(
      executeMock.mock.calls.some((call) => call[0]?.operation === "createBooking"),
    ).toBe(false);
    expect(bookingRepo.bookings.filter((b) => b.status === "BOOKED")).toHaveLength(1);
  });

  it("replays idempotency key without a second createBooking", async () => {
    configureShiprocketBookedExecuteMock();

    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
      providerCode: "SHIPROCKET",
      quoteSnapshot: shiprocketOrchestrationQuoteSnapshot(),
    });
    await seedPaidPayment({ paymentRepo, deliveryId: seeded.deliveryId, customerId });

    const service = buildBookingService();
    const idempotencyKey = randomUUID();
    const requestHash = hashConfirmRequest();

    const first = await service.confirm({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-sr-idem-1",
      idempotencyKey,
      requestHash,
    });

    executeMock.mockClear();

    const second = await service.confirm({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-sr-idem-2",
      idempotencyKey,
      requestHash,
    });

    expect(second.data).toEqual(first.data);
    expect(
      executeMock.mock.calls.some((call) => call[0]?.operation === "createBooking"),
    ).toBe(false);
  });

  it("allows only one BOOKED outcome under concurrent duplicate confirms", async () => {
    let createBookingCalls = 0;
    executeMock.mockImplementation(async (input: { operation: string }) => {
      if (input.operation === "getCancellationPolicy") {
        return mockCancellationPolicy();
      }
      if (input.operation === "createBooking") {
        createBookingCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return mockShiprocketBookedAdapterResult();
      }
      throw new Error(`Unexpected operation ${input.operation}`);
    });

    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
      providerCode: "SHIPROCKET",
      quoteSnapshot: shiprocketOrchestrationQuoteSnapshot(),
    });
    await seedPaidPayment({ paymentRepo, deliveryId: seeded.deliveryId, customerId });

    const service = buildBookingService();
    const confirmInput = {
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER" as const,
      requestHash: hashConfirmRequest(),
    };

    const outcomes = await Promise.allSettled([
      service.confirm({ ...confirmInput, requestId: "req-sr-conc-1" }),
      service.confirm({ ...confirmInput, requestId: "req-sr-conc-2" }),
    ]);

    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(
      bookingRepo.bookings.filter((booking) => booking.status === "BOOKED"),
    ).toHaveLength(1);
    expect(createBookingCalls).toBe(1);
  });

  it("does not call createBooking again after UNKNOWN reconciles to BOOKED", async () => {
    executeMock.mockImplementation(async (input: { operation: string }) => {
      if (input.operation === "getCancellationPolicy") {
        return mockCancellationPolicy();
      }
      if (input.operation === "createBooking") {
        return {
          success: false,
          outcome: "UNKNOWN",
          providerBookingId: "SR-ORDER-RECON",
          providerReference: "888001",
          status: "NEW",
          bookedAt: null,
          estimatedPickupAt: null,
          estimatedDeliveryAt: null,
          trackingUrl: null,
          driver: null,
          service: null,
          reason: "AWB assignment failed.",
          metadata: { shiprocketShipmentId: "888001" },
        };
      }
      if (input.operation === "getBooking") {
        return mockShiprocketBookedAdapterResult({
          providerBookingId: "SR-ORDER-RECON",
          awb: "SR998877665IN",
          shipmentId: "888001",
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
      quoteSnapshot: shiprocketOrchestrationQuoteSnapshot(),
    });
    await seedPaidPayment({ paymentRepo, deliveryId: seeded.deliveryId, customerId });

    const service = buildBookingService();
    await expect(
      service.confirm({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-sr-unknown-1",
        requestHash: hashConfirmRequest(),
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.BOOKING_UNKNOWN });

    executeMock.mockClear();

    await service.confirm({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-sr-unknown-2",
      requestHash: hashConfirmRequest(),
    });

    expect(
      executeMock.mock.calls.some((call) => call[0]?.operation === "createBooking"),
    ).toBe(false);
    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "getBooking", providerCode: "SHIPROCKET" }),
    );

    executeMock.mockClear();

    const third = await service.confirm({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-sr-unknown-3",
      requestHash: hashConfirmRequest(),
    });

    expect(third.data.booking.status).toBe("BOOKED");
    expect(
      executeMock.mock.calls.some((call) => call[0]?.operation === "createBooking"),
    ).toBe(false);
  });

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

  it("reconciles concurrent UNKNOWN confirms with at most one BOOKED and no createBooking", async () => {
    let getBookingCalls = 0;
    executeMock.mockImplementation(async (input: { operation: string }) => {
      if (input.operation === "getCancellationPolicy") {
        return mockCancellationPolicy();
      }
      if (input.operation === "createBooking") {
        return {
          success: false,
          outcome: "UNKNOWN",
          providerBookingId: "SR-CONC-UNK",
          providerReference: "111222",
          status: "NEW",
          bookedAt: null,
          estimatedPickupAt: null,
          estimatedDeliveryAt: null,
          trackingUrl: null,
          driver: null,
          service: null,
          reason: "Timed out.",
          metadata: { shiprocketShipmentId: "111222" },
        };
      }
      if (input.operation === "getBooking") {
        getBookingCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return mockShiprocketBookedAdapterResult({
          providerBookingId: "SR-CONC-UNK",
          awb: "SR111222333IN",
          shipmentId: "111222",
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
      quoteSnapshot: shiprocketOrchestrationQuoteSnapshot(),
    });
    await seedPaidPayment({ paymentRepo, deliveryId: seeded.deliveryId, customerId });

    const service = buildBookingService();
    await expect(
      service.confirm({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-unk-seed",
        requestHash: hashConfirmRequest(),
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.BOOKING_UNKNOWN });

    executeMock.mockClear();
    getBookingCalls = 0;

    const confirmInput = {
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER" as const,
      requestHash: hashConfirmRequest(),
    };

    const outcomes = await Promise.allSettled([
      service.confirm({ ...confirmInput, requestId: "req-unk-conc-1" }),
      service.confirm({ ...confirmInput, requestId: "req-unk-conc-2" }),
    ]);

    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(
      bookingRepo.bookings.filter((booking) => booking.status === "BOOKED"),
    ).toHaveLength(1);
    expect(
      executeMock.mock.calls.some((call) => call[0]?.operation === "createBooking"),
    ).toBe(false);
    expect(getBookingCalls).toBeGreaterThanOrEqual(1);
  });
});
