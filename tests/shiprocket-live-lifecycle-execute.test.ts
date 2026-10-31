import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      SHIPROCKET_PICKUP_LOCATION: "Doot Live Test Pickup",
    },
  };
});

import { BookingService } from "../src/modules/booking/booking.service.js";
import { createTestRuntimeSettingsService } from "./helpers/test-runtime-settings.js";
import { CancellationService } from "../src/modules/cancellation/cancellation.service.js";
import { DeliveryLifecycleService } from "../src/modules/delivery/delivery-lifecycle.service.js";
import { ProviderAdapterExecutor } from "../src/modules/provider/adapters/provider-adapter-executor.js";
import { initializeProviderAdapters } from "../src/modules/provider/adapters/bootstrap.js";
import { runShiprocketLiveLifecycle } from "../src/modules/provider/adapters/shiprocket/shiprocket-live-lifecycle-execute.lib.js";
import {
  SHIPROCKET_LIVE_CANCEL_CONFIRM_PHRASE,
  SHIPROCKET_LIVE_HOST_CONFIRM_PHRASE,
  ShiprocketLiveLifecycleGuardError,
} from "../src/modules/provider/adapters/shiprocket/shiprocket-live-lifecycle.guards.js";
import { enrichQuoteSnapshotWithCustomerPricing } from "../src/modules/pricing/customer-delivery-pricing.js";
import {
  seedOptionReadyDelivery,
  seedPaidPayment,
} from "./helpers/booking-test-helpers.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryCancellationRepository } from "./helpers/in-memory-cancellation-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryPaymentRepository } from "./helpers/in-memory-payment-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { seedOrchestrationMockProvider } from "./helpers/provider-adapter-test-helpers.js";

function liveQuoteSnapshot() {
  return enrichQuoteSnapshotWithCustomerPricing(
    {
      amount: 150,
      currency: "INR",
      providerQuoteId: "501",
      quotedAt: new Date().toISOString(),
      providerMetadata: {
        shiprocketHyperlocalRate: { courier_id: 501, rates: 120 },
        shiprocketPickupPostcode: "400001",
        shiprocketDeliveryPostcode: "400050",
        shiprocketPickupCity: "Mumbai",
        shiprocketPickupState: "Maharashtra",
        shiprocketDeliveryCity: "Mumbai",
        shiprocketDeliveryState: "Maharashtra",
        shiprocketBillingEmail: "billing@example.test",
      },
    },
    10,
  );
}

describe("Shiprocket live lifecycle execute (mocked services)", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let providerRepo: InMemoryProviderRepository;
  let orchestrationRepo: InMemoryOrchestrationRepository;
  let bookingRepo: InMemoryBookingRepository;
  let paymentRepo: InMemoryPaymentRepository;
  let cancellationRepo: InMemoryCancellationRepository;
  let executeMock: ReturnType<typeof vi.fn>;
  let customerId: string;

  beforeEach(() => {
    initializeProviderAdapters();
    deliveryRepo = new InMemoryDeliveryRepository();
    providerRepo = new InMemoryProviderRepository();
    orchestrationRepo = new InMemoryOrchestrationRepository();
    bookingRepo = new InMemoryBookingRepository();
    paymentRepo = new InMemoryPaymentRepository();
    cancellationRepo = new InMemoryCancellationRepository();
    executeMock = vi.fn();
    customerId = randomUUID();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function buildDeps() {
    const adapterExecutor = {
      execute: executeMock,
    } as unknown as ProviderAdapterExecutor;
    return {
      bookingService: new BookingService(
        deliveryRepo,
        providerRepo,
        orchestrationRepo,
        bookingRepo,
        adapterExecutor,
        paymentRepo,
        createTestRuntimeSettingsService(),
      ),
      cancellationService: new CancellationService(
        deliveryRepo,
        bookingRepo,
        providerRepo,
        cancellationRepo,
        new DeliveryLifecycleService(deliveryRepo),
        adapterExecutor,
        paymentRepo,
      ),
      adapterExecutor,
      deliveryRepo,
      bookingRepo,
      cancellationRepo,
      orchestrationRepo,
      paymentRepo,
      providerRepo,
    };
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

  function mockBookedResult(overrides?: {
    awb?: string | null;
    outcome?: "BOOKED" | "UNKNOWN";
  }) {
    const awb = overrides?.awb === undefined ? "SR123456789IN" : overrides.awb;
    const booked = awb != null && awb.length > 0;
    return {
      success: booked,
      outcome:
        overrides?.outcome ?? (booked ? ("BOOKED" as const) : ("UNKNOWN" as const)),
      providerBookingId: "16161616",
      providerReference: "15151515",
      status: booked ? "READY" : "NEW",
      bookedAt: new Date().toISOString(),
      estimatedPickupAt: null,
      estimatedDeliveryAt: null,
      trackingUrl: null,
      driver: null,
      service: null,
      reason: booked ? null : "No AWB",
      amount: { amount: 150, currency: "INR" as const },
      metadata: {
        shiprocketOrderId: "16161616",
        shiprocketShipmentId: "15151515",
        shiprocketAwbCode: awb,
        shiprocketCourierId: 501,
      },
    };
  }

  function configureHappyPathMocks() {
    executeMock.mockImplementation(async (input: { operation: string }) => {
      if (input.operation === "getCancellationPolicy") {
        return mockCancellationPolicy();
      }
      if (input.operation === "createBooking") {
        return mockBookedResult();
      }
      if (input.operation === "getBooking") {
        return mockBookedResult();
      }
      if (input.operation === "getTracking") {
        return {
          status: "At pickup",
          latitude: null,
          longitude: null,
          accuracyMeters: null,
          providerTimestamp: null,
          receivedAt: new Date().toISOString(),
          eta: null,
          trackingUrl: null,
          driver: null,
          providerEventId: null,
          metadata: {},
        };
      }
      if (input.operation === "cancelBooking") {
        return {
          success: true,
          outcome: "CANCELLED",
          providerCancellationId: "PC-1",
          status: "CANCELLED",
          reason: null,
          cancelledAt: new Date().toISOString(),
        };
      }
      throw new Error(`Unexpected operation ${input.operation}`);
    });
  }

  async function seedLiveExecuteDelivery() {
    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
      providerCode: "SHIPROCKET",
      providerEnvironment: "LIVE",
      pickupLatitude: 19.076,
      pickupLongitude: 72.8777,
      dropLatitude: 19.08,
      dropLongitude: 72.88,
      quoteSnapshot: liveQuoteSnapshot(),
    });
    await seedPaidPayment({
      paymentRepo,
      deliveryId: seeded.deliveryId,
      customerId,
    });
    return seeded;
  }

  function liveProviderFor(seeded: { providerId: string }) {
    return {
      code: "SHIPROCKET",
      environment: "LIVE" as const,
      baseUrl: "https://apiv2.shiprocket.in",
      providerId: seeded.providerId,
    };
  }

  it("dry-run validates delivery context without production confirmation, HTTP, or mutations", async () => {
    const seeded = await seedLiveExecuteDelivery();
    const result = await runShiprocketLiveLifecycle(buildDeps(), {
      dryRun: true,
      runId: "dry-run-1",
      deliveryId: seeded.deliveryId,
      deliveryReference: seeded.deliveryReference,
      shiprocketEnabled: true,
      shiprocketBookingEnabled: true,
      pickupLocation: "Doot Live Test Pickup",
      provider: liveProviderFor(seeded),
    });
    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.phases.map((p) => p.phase)).toContain("preflight");
    expect(executeMock).not.toHaveBeenCalled();
    expect(bookingRepo.bookings).toHaveLength(0);
  });

  it("execute rejects missing production-host confirmation before mutations", async () => {
    configureHappyPathMocks();
    const seeded = await seedLiveExecuteDelivery();
    const reportsRoot = await mkdtemp(join(tmpdir(), "sr-live-no-confirm-"));

    await expect(
      runShiprocketLiveLifecycle(buildDeps(), {
        dryRun: false,
        runId: "exec-no-host-confirm",
        reportsRoot,
        deliveryId: seeded.deliveryId,
        deliveryReference: seeded.deliveryReference,
        confirmCancel: SHIPROCKET_LIVE_CANCEL_CONFIRM_PHRASE,
        shiprocketEnabled: true,
        shiprocketBookingEnabled: true,
        pickupLocation: "Doot Live Test Pickup",
        provider: liveProviderFor(seeded),
      }),
    ).rejects.toThrow(/confirm-live-host/);

    expect(executeMock).not.toHaveBeenCalled();
    expect(bookingRepo.bookings).toHaveLength(0);
  });

  it("runs full mocked execute sequence with artifacts and cancel gate", async () => {
    configureHappyPathMocks();
    const seeded = await seedLiveExecuteDelivery();
    const reportsRoot = await mkdtemp(join(tmpdir(), "sr-live-"));
    const runId = `exec-${randomUUID()}`;

    const result = await runShiprocketLiveLifecycle(buildDeps(), {
      dryRun: false,
      runId,
      deliveryId: seeded.deliveryId,
      deliveryReference: seeded.deliveryReference,
      confirmLiveHost: SHIPROCKET_LIVE_HOST_CONFIRM_PHRASE,
      confirmCancel: SHIPROCKET_LIVE_CANCEL_CONFIRM_PHRASE,
      shiprocketEnabled: true,
      shiprocketBookingEnabled: true,
      pickupLocation: "Doot Live Test Pickup",
      provider: liveProviderFor(seeded),
      reportsRoot,
    });

    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.providerOrderId).toBe("16161616");
    expect(result.phases.map((p) => p.phase)).toEqual(
      expect.arrayContaining([
        "book",
        "order_show",
        "tracking",
        "cancel_gate",
        "cancel",
        "post_cancel_order_show",
        "post_cancel_tracking",
      ]),
    );

    const createCalls = executeMock.mock.calls.filter(
      (call) => call[0]?.operation === "createBooking",
    );
    expect(createCalls).toHaveLength(1);

    const runDir = join(reportsRoot, runId);
    const files = await readdir(runDir);
    expect(files.some((name) => name.startsWith("db-"))).toBe(true);
    const summary = JSON.parse(
      await readFile(join(runDir, "run-summary.json"), "utf8"),
    );
    expect(summary.ok).toBe(true);
  });

  it("requires cancel confirmation before CancellationService.cancel", async () => {
    configureHappyPathMocks();
    const seeded = await seedLiveExecuteDelivery();
    const reportsRoot = await mkdtemp(join(tmpdir(), "sr-live-"));

    await expect(
      runShiprocketLiveLifecycle(buildDeps(), {
        dryRun: false,
        runId: "no-cancel-confirm",
        reportsRoot,
        deliveryId: seeded.deliveryId,
        deliveryReference: seeded.deliveryReference,
        confirmLiveHost: SHIPROCKET_LIVE_HOST_CONFIRM_PHRASE,
        shiprocketEnabled: true,
        shiprocketBookingEnabled: true,
        pickupLocation: "Doot Live Test Pickup",
        provider: liveProviderFor(seeded),
      }),
    ).rejects.toThrow(ShiprocketLiveLifecycleGuardError);

    const cancelCalls = executeMock.mock.calls.filter(
      (call) => call[0]?.operation === "cancelBooking",
    );
    expect(cancelCalls).toHaveLength(0);
  });

  it("stops on missing AWB after book without cancel POST", async () => {
    executeMock.mockImplementation(async (input: { operation: string }) => {
      if (input.operation === "getCancellationPolicy") {
        return mockCancellationPolicy();
      }
      if (input.operation === "createBooking") {
        return mockBookedResult({ awb: null, outcome: "UNKNOWN" });
      }
      throw new Error(`Unexpected operation ${input.operation}`);
    });

    const seeded = await seedLiveExecuteDelivery();
    const reportsRoot = await mkdtemp(join(tmpdir(), "sr-live-"));
    const result = await runShiprocketLiveLifecycle(buildDeps(), {
      dryRun: false,
      runId: "missing-awb",
      reportsRoot,
      deliveryId: seeded.deliveryId,
      deliveryReference: seeded.deliveryReference,
      confirmLiveHost: SHIPROCKET_LIVE_HOST_CONFIRM_PHRASE,
      confirmCancel: SHIPROCKET_LIVE_CANCEL_CONFIRM_PHRASE,
      shiprocketEnabled: true,
      shiprocketBookingEnabled: true,
      pickupLocation: "Doot Live Test Pickup",
      provider: liveProviderFor(seeded),
    });

    expect(result.ok).toBe(false);
    expect(result.stopCode).toBe("BOOKING_UNKNOWN");
    expect(
      executeMock.mock.calls.some((call) => call[0]?.operation === "cancelBooking"),
    ).toBe(false);
  });

  it("stops on rejected cancellation outcome", async () => {
    executeMock.mockImplementation(async (input: { operation: string }) => {
      if (input.operation === "getCancellationPolicy") {
        return mockCancellationPolicy();
      }
      if (input.operation === "createBooking") {
        return mockBookedResult();
      }
      if (input.operation === "getBooking") {
        return mockBookedResult();
      }
      if (input.operation === "getTracking") {
        return {
          status: "At pickup",
          latitude: null,
          longitude: null,
          accuracyMeters: null,
          providerTimestamp: null,
          receivedAt: new Date().toISOString(),
          eta: null,
          trackingUrl: null,
          driver: null,
          providerEventId: null,
        };
      }
      if (input.operation === "cancelBooking") {
        return {
          success: false,
          outcome: "REJECTED",
          providerCancellationId: null,
          status: "REJECTED",
          reason: "Cannot cancel",
          cancelledAt: null,
        };
      }
      throw new Error(`Unexpected operation ${input.operation}`);
    });

    const seeded = await seedLiveExecuteDelivery();
    const reportsRoot = await mkdtemp(join(tmpdir(), "sr-live-"));
    const result = await runShiprocketLiveLifecycle(buildDeps(), {
      dryRun: false,
      runId: "cancel-rejected",
      reportsRoot,
      deliveryId: seeded.deliveryId,
      deliveryReference: seeded.deliveryReference,
      confirmLiveHost: SHIPROCKET_LIVE_HOST_CONFIRM_PHRASE,
      confirmCancel: SHIPROCKET_LIVE_CANCEL_CONFIRM_PHRASE,
      shiprocketEnabled: true,
      shiprocketBookingEnabled: true,
      pickupLocation: "Doot Live Test Pickup",
      provider: liveProviderFor(seeded),
    });

    expect(result.ok).toBe(false);
    expect(result.stopCode).toBe("CANCEL_REJECTED");
  });

  it("reuses confirm idempotency without a second createBooking call", async () => {
    configureHappyPathMocks();
    const seeded = await seedLiveExecuteDelivery();
    const deps = buildDeps();
    const reportsRoot = await mkdtemp(join(tmpdir(), "sr-live-"));
    const runId = "idem-confirm";
    const baseInput = {
      dryRun: false as const,
      runId,
      reportsRoot,
      deliveryId: seeded.deliveryId,
      deliveryReference: seeded.deliveryReference,
      confirmLiveHost: SHIPROCKET_LIVE_HOST_CONFIRM_PHRASE,
      confirmCancel: SHIPROCKET_LIVE_CANCEL_CONFIRM_PHRASE,
      shiprocketEnabled: true,
      shiprocketBookingEnabled: true,
      pickupLocation: "Doot Live Test Pickup",
      provider: liveProviderFor(seeded),
      skipCancellation: true,
    };

    const first = await runShiprocketLiveLifecycle(deps, baseInput);
    expect(first.ok).toBe(true);

    await expect(runShiprocketLiveLifecycle(deps, baseInput)).rejects.toMatchObject({
      code: "ALREADY_BOOKED",
    });

    const createCalls = executeMock.mock.calls.filter(
      (call) => call[0]?.operation === "createBooking",
    );
    expect(createCalls).toHaveLength(1);
  });

  it("rejects execute when delivery reference mismatches", async () => {
    const seeded = await seedLiveExecuteDelivery();
    await expect(
      runShiprocketLiveLifecycle(buildDeps(), {
        dryRun: true,
        runId: "ref-mismatch",
        deliveryId: seeded.deliveryId,
        deliveryReference: "WRONG-REF",
        confirmLiveHost: SHIPROCKET_LIVE_HOST_CONFIRM_PHRASE,
        shiprocketEnabled: true,
        shiprocketBookingEnabled: true,
        pickupLocation: "Doot Live Test Pickup",
        provider: liveProviderFor(seeded),
      }),
    ).rejects.toMatchObject({ code: "DELIVERY_REFERENCE_MISMATCH" });
  });

  it("rejects when resolved provider id does not match orchestration provider", async () => {
    const seeded = await seedLiveExecuteDelivery();
    await expect(
      runShiprocketLiveLifecycle(buildDeps(), {
        dryRun: true,
        runId: "provider-mismatch",
        deliveryId: seeded.deliveryId,
        deliveryReference: seeded.deliveryReference,
        confirmLiveHost: SHIPROCKET_LIVE_HOST_CONFIRM_PHRASE,
        shiprocketEnabled: true,
        shiprocketBookingEnabled: true,
        pickupLocation: "Doot Live Test Pickup",
        provider: {
          ...liveProviderFor(seeded),
          providerId: randomUUID(),
        },
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_IDENTITY_MISMATCH" });
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("rejects when multiple SHIPROCKET provider rows exist", async () => {
    await seedOrchestrationMockProvider(providerRepo, {
      code: "SHIPROCKET",
      environment: "LIVE",
    });
    const seeded = await seedLiveExecuteDelivery();
    await expect(
      runShiprocketLiveLifecycle(buildDeps(), {
        dryRun: true,
        runId: "provider-ambiguous",
        deliveryId: seeded.deliveryId,
        deliveryReference: seeded.deliveryReference,
        confirmLiveHost: SHIPROCKET_LIVE_HOST_CONFIRM_PHRASE,
        shiprocketEnabled: true,
        shiprocketBookingEnabled: true,
        pickupLocation: "Doot Live Test Pickup",
        provider: liveProviderFor(seeded),
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_AMBIGUOUS" });
  });
});
