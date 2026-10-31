import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { CancellationService } from "../src/modules/cancellation/cancellation.service.js";
import { DeliveryLifecycleService } from "../src/modules/delivery/delivery-lifecycle.service.js";
import { initializeProviderAdapters } from "../src/modules/provider/adapters/bootstrap.js";
import { ProviderAdapterExecutor } from "../src/modules/provider/adapters/provider-adapter-executor.js";
import { ProviderAdapterError } from "../src/modules/provider/contracts/provider-error.js";
import { seedOptionReadyDelivery } from "./helpers/booking-test-helpers.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryCancellationRepository } from "./helpers/in-memory-cancellation-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryPaymentRepository } from "./helpers/in-memory-payment-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";

describe("Shiprocket cancellation integration (service workflows)", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let bookingRepo: InMemoryBookingRepository;
  let providerRepo: InMemoryProviderRepository;
  let orchestrationRepo: InMemoryOrchestrationRepository;
  let paymentRepo: InMemoryPaymentRepository;
  let cancellationRepo: InMemoryCancellationRepository;
  let executeMock: ReturnType<typeof vi.fn>;
  let service: CancellationService;
  const customerId = randomUUID();

  beforeEach(() => {
    initializeProviderAdapters();
    deliveryRepo = new InMemoryDeliveryRepository();
    bookingRepo = new InMemoryBookingRepository();
    providerRepo = new InMemoryProviderRepository();
    orchestrationRepo = new InMemoryOrchestrationRepository();
    paymentRepo = new InMemoryPaymentRepository();
    cancellationRepo = new InMemoryCancellationRepository();
    executeMock = vi.fn();
    service = new CancellationService(
      deliveryRepo,
      bookingRepo,
      providerRepo,
      cancellationRepo,
      new DeliveryLifecycleService(deliveryRepo),
      { execute: executeMock } as unknown as ProviderAdapterExecutor,
      paymentRepo,
    );
  });

  async function seedShiprocketBookedDelivery(input?: {
    providerOrderId?: string;
    quoteSnapshot?: Record<string, unknown>;
  }) {
    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
      providerCode: "SHIPROCKET",
      quoteSnapshot: input?.quoteSnapshot,
    });

    await deliveryRepo.transitionStatus({
      deliveryId: seeded.deliveryId,
      expectedFromStatuses: ["OPTION_READY"],
      toStatus: "BOOKING",
      source: "BOOKING",
      reason: "test",
    });

    const booking = await bookingRepo.createBookingAttempt({
      deliveryId: seeded.deliveryId,
      attemptNumber: 1,
      orchestrationRequestId: seeded.orchestrationRequestId,
      orchestrationOptionId: seeded.selectedOptionId,
      providerId: seeded.providerId,
      providerServiceId: null,
      providerCode: "SHIPROCKET",
      providerServiceCode: "MOCK_BIKE",
      correlationReference: `${seeded.deliveryReference}-BOOKING-1`,
      quotedAmount: 150,
      quotedCurrency: "INR",
      providerQuoteId: "Q1",
      quoteSnapshot: input?.quoteSnapshot ?? {
        amount: 150,
        currency: "INR",
        quotedAt: new Date().toISOString(),
        providerMetadata: {
          shiprocketOrderId: "16161616",
          shiprocketAwbCode: "SR123456789IN",
        },
      },
      requestId: "req-booking",
    });

    await bookingRepo.finalizeBooking({
      bookingId: booking.id,
      status: "BOOKED",
      providerOrderId: input?.providerOrderId ?? "16161616",
      providerReference: "15151515",
      bookedAt: new Date(),
    });

    await deliveryRepo.transitionStatus({
      deliveryId: seeded.deliveryId,
      expectedFromStatuses: ["BOOKING"],
      toStatus: "BOOKED",
      source: "BOOKING",
      reason: "test",
    });

    return { ...seeded, bookingId: booking.id };
  }

  function mockProviderCancelSuccess() {
    executeMock.mockResolvedValue({
      success: true,
      outcome: "CANCELLED",
      providerCancellationId: "PC-SR-1",
      status: "CANCELLED",
      reason: null,
      cancelledAt: new Date().toISOString(),
    });
  }

  it("cancels OPTION_READY Shiprocket delivery locally without provider call", async () => {
    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
      providerCode: "SHIPROCKET",
    });

    const result = await service.cancel({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-sr-local",
      reasonCode: "CUSTOMER_CHANGED_MIND",
      requestHash: "hash-sr-local",
    });

    expect(result.data.delivery.status).toBe("CANCELLED");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("calls provider cancel with numeric Shiprocket order id when BOOKED", async () => {
    mockProviderCancelSuccess();
    const seeded = await seedShiprocketBookedDelivery();

    const result = await service.cancel({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-sr-cancel",
      reasonCode: "CUSTOMER_CHANGED_MIND",
      requestHash: "hash-sr-cancel",
    });

    expect(result.data.delivery.status).toBe("CANCELLED");
    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "cancelBooking",
        providerCode: "SHIPROCKET",
        payload: expect.objectContaining({ providerBookingId: "16161616" }),
      }),
    );
  });

  it("resolves numeric order id from quote metadata when providerOrderId is a channel id", async () => {
    mockProviderCancelSuccess();
    const seeded = await seedShiprocketBookedDelivery({
      providerOrderId: "DOOT-CHANNEL-REF",
      quoteSnapshot: {
        amount: 150,
        currency: "INR",
        quotedAt: new Date().toISOString(),
        providerMetadata: { shiprocketOrderId: "90909090" },
      },
    });

    await service.cancel({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-sr-meta-id",
      reasonCode: "CUSTOMER_CHANGED_MIND",
      requestHash: "hash-sr-meta-id",
    });

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ providerBookingId: "90909090" }),
      }),
    );
  });

  it("rejects provider cancel when no numeric Shiprocket order id is available", async () => {
    const seeded = await seedShiprocketBookedDelivery({
      providerOrderId: "DOOT-CHANNEL-ONLY",
      quoteSnapshot: {
        amount: 150,
        currency: "INR",
        quotedAt: new Date().toISOString(),
        providerMetadata: { shiprocketChannelOrderId: "DOOT-CHANNEL-ONLY" },
      },
    });

    await expect(
      service.cancel({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-sr-invalid-id",
        reasonCode: "CUSTOMER_CHANGED_MIND",
        requestHash: "hash-sr-invalid-id",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.PROVIDER_CANCELLATION_REJECTED,
    });

    expect(executeMock).not.toHaveBeenCalled();
    const delivery = await deliveryRepo.findById(seeded.deliveryId);
    expect(delivery?.status).toBe("BOOKED");
  });

  it("does not mark delivery CANCELLED when provider returns REJECTED", async () => {
    executeMock.mockResolvedValue({
      success: false,
      outcome: "REJECTED",
      providerCancellationId: null,
      status: "ACTIVE",
      reason: "Too late",
      cancelledAt: null,
    });

    const seeded = await seedShiprocketBookedDelivery();

    await expect(
      service.cancel({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-sr-rejected",
        reasonCode: "CUSTOMER_CHANGED_MIND",
        requestHash: "hash-sr-rejected",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.PROVIDER_CANCELLATION_REJECTED,
    });

    expect(await deliveryRepo.findById(seeded.deliveryId)).toMatchObject({
      status: "BOOKED",
    });
  });

  it("returns UNKNOWN and leaves delivery BOOKED when provider cancel is ambiguous", async () => {
    executeMock.mockResolvedValue({
      success: false,
      outcome: "UNKNOWN",
      providerCancellationId: null,
      status: "UNKNOWN",
      reason: "Could not confirm cancellation.",
      cancelledAt: null,
    });

    const seeded = await seedShiprocketBookedDelivery();

    await expect(
      service.cancel({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-sr-unknown",
        reasonCode: "CUSTOMER_CHANGED_MIND",
        requestHash: "hash-sr-unknown",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.CANCELLATION_UNKNOWN,
    });

    expect(await deliveryRepo.findById(seeded.deliveryId)).toMatchObject({
      status: "BOOKED",
    });
    expect(cancellationRepo.cancellations[0]?.status).toBe("UNKNOWN");
    expect(paymentRepo.refunds.size).toBe(0);
  });

  it("classifies provider timeout as UNKNOWN without cancelling delivery", async () => {
    executeMock.mockRejectedValue(
      new ProviderAdapterError({
        providerCode: "SHIPROCKET",
        operation: "cancelBooking",
        category: "PROVIDER_TIMEOUT",
        safeMessage: "Timed out.",
      }),
    );

    const seeded = await seedShiprocketBookedDelivery();

    await expect(
      service.cancel({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-sr-timeout",
        reasonCode: "CUSTOMER_CHANGED_MIND",
        requestHash: "hash-sr-timeout",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.CANCELLATION_UNKNOWN,
    });

    expect(await deliveryRepo.findById(seeded.deliveryId)).toMatchObject({
      status: "BOOKED",
    });
  });

  it("replays idempotency key without a second provider cancel call", async () => {
    mockProviderCancelSuccess();
    const seeded = await seedShiprocketBookedDelivery();
    const idempotencyKey = randomUUID();
    const requestHash = "hash-sr-idem";

    const first = await service.cancel({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-sr-idem-1",
      idempotencyKey,
      reasonCode: "CUSTOMER_CHANGED_MIND",
      requestHash,
    });

    executeMock.mockClear();

    const second = await service.cancel({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-sr-idem-2",
      idempotencyKey,
      reasonCode: "CUSTOMER_CHANGED_MIND",
      requestHash,
    });

    expect(second.data).toEqual(first.data);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("rejects cancellation after pickup without provider call", async () => {
    mockProviderCancelSuccess();
    const seeded = await seedShiprocketBookedDelivery();
    await deliveryRepo.transitionStatus({
      deliveryId: seeded.deliveryId,
      expectedFromStatuses: ["BOOKED"],
      toStatus: "PICKED_UP",
      source: "OTP",
      reason: "test pickup",
    });

    await expect(
      service.cancel({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        requestId: "req-sr-post-pickup",
        reasonCode: "CUSTOMER_CHANGED_MIND",
        requestHash: "hash-sr-post-pickup",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.CANCELLATION_NOT_ALLOWED,
    });

    expect(executeMock).not.toHaveBeenCalled();
  });
});
