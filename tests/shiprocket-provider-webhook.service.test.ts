import { beforeEach, describe, expect, it, vi } from "vitest";

const { webhookApiKey } = vi.hoisted(() => ({
  webhookApiKey: "shiprocket-webhook-test-key",
}));

vi.mock("../src/config/env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config/env.js")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      SHIPROCKET_WEBHOOK_ENABLED: true,
      SHIPROCKET_WEBHOOK_API_KEY: webhookApiKey,
    },
    requireShiprocketWebhookApiKey: () => webhookApiKey,
  };
});

import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { AppError } from "../src/core/errors/app-error.js";
import { DeliveryLifecycleService } from "../src/modules/delivery/delivery-lifecycle.service.js";
import { normalizeShiprocketTrackingWebhook } from "../src/modules/provider/adapters/shiprocket/shiprocket-webhook.normalize.js";
import { ShiprocketProviderWebhookService } from "../src/modules/provider/webhook/shiprocket-provider-webhook.service.js";
import { TrackingService } from "../src/modules/tracking/tracking.service.js";
import { seedOptionReadyDelivery } from "./helpers/booking-test-helpers.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { InMemoryProviderWebhookEventRepository } from "./helpers/in-memory-provider-webhook-event-repository.js";
import { PROVIDER_WEBHOOK_PROCESSING_LEASE_STALE_MS } from "../src/modules/provider/provider.webhook.repository.js";
import { InMemoryTrackingRepository } from "./helpers/in-memory-tracking-repository.js";
import { TestShiprocketDeliveryLinkResolver } from "./helpers/test-shiprocket-delivery-link-resolver.js";

describe("ShiprocketProviderWebhookService", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let bookingRepo: InMemoryBookingRepository;
  let trackingRepo: InMemoryTrackingRepository;
  let webhookRepo: InMemoryProviderWebhookEventRepository;
  let service: ShiprocketProviderWebhookService;
  const customerId = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    deliveryRepo = new InMemoryDeliveryRepository();
    bookingRepo = new InMemoryBookingRepository();
    trackingRepo = new InMemoryTrackingRepository();
    webhookRepo = new InMemoryProviderWebhookEventRepository();
    const lifecycle = new DeliveryLifecycleService(deliveryRepo);
    const tracking = new TrackingService(deliveryRepo, trackingRepo, lifecycle);
    service = new ShiprocketProviderWebhookService(
      webhookRepo,
      new TestShiprocketDeliveryLinkResolver(bookingRepo),
      deliveryRepo,
      tracking,
    );
  });

  async function seedShiprocketBooked(input?: {
    providerOrderId?: string;
    awb?: string;
    deliveryId?: string;
  }) {
    const orchestrationRepo = new InMemoryOrchestrationRepository();
    const providerRepo = new InMemoryProviderRepository();
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

    const booking = await bookingRepo.createBookingAttempt({
      deliveryId: seeded.deliveryId,
      attemptNumber: 1,
      orchestrationRequestId: seeded.orchestrationRequestId,
      orchestrationOptionId: seeded.selectedOptionId,
      providerId: seeded.providerId,
      providerServiceId: null,
      providerCode: "SHIPROCKET",
      providerServiceCode: "HYPERLOCAL",
      correlationReference: `${seeded.deliveryReference}-BOOKING-1`,
      quotedAmount: 150,
      quotedCurrency: "INR",
      providerQuoteId: "Q1",
      quoteSnapshot: {
        amount: 150,
        currency: "INR",
        quotedAt: new Date().toISOString(),
        providerMetadata: {
          shiprocketAwbCode: input?.awb ?? "SR123456789IN",
        },
      },
      requestId: "req",
    });

    await bookingRepo.finalizeBooking({
      bookingId: booking.id,
      status: "BOOKED",
      providerOrderId: input?.providerOrderId ?? "16161616",
      providerReference: "15151515",
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

    return {
      deliveryId: seeded.deliveryId,
      bookingId: booking.id,
      providerId: seeded.providerId,
    };
  }

  function buildPayload(overrides?: Record<string, unknown>) {
    return JSON.stringify({
      awb: "SR123456789IN",
      sr_order_id: "16161616",
      order_id: "16161616",
      current_status: "IN TRANSIT",
      current_status_id: 17,
      current_timestamp: "2026-03-28 10:00:00",
      is_return: false,
      scans: [
        {
          date: "2026-03-28 10:00:00",
          activity: "Picked up",
          location: "Delhi",
          status: "PICKED UP",
          status_id: 6,
        },
        {
          date: "2026-03-28 14:30:00",
          activity: "In transit",
          location: "Delhi Hub",
          status: "IN TRANSIT",
          status_id: 17,
        },
      ],
      ...overrides,
    });
  }

  it("rejects when webhook is disabled", async () => {
    const disabled = new ShiprocketProviderWebhookService();
    vi.spyOn(disabled, "assertEnabledAndAuthenticated").mockImplementation(() => {
      throw new AppError("Shiprocket webhooks are disabled.", {
        statusCode: 404,
        code: ErrorCodes.NOT_FOUND,
      });
    });
    await expect(
      disabled.handle({
        requestId: "req",
        rawBody: buildPayload(),
        apiKey: webhookApiKey,
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.NOT_FOUND });
  });

  it("rejects missing and incorrect API keys", async () => {
    await expect(
      service.handle({
        requestId: "req",
        rawBody: buildPayload(),
        apiKey: undefined,
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PROVIDER_WEBHOOK_SIGNATURE });

    await expect(
      service.handle({
        requestId: "req",
        rawBody: buildPayload(),
        apiKey: "wrong",
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_PROVIDER_WEBHOOK_SIGNATURE });
  });

  it("processes valid multi-scan payloads and deduplicates webhook retries", async () => {
    await seedShiprocketBooked();
    const rawBody = buildPayload();

    const first = await service.handle({
      requestId: "req-1",
      rawBody,
      apiKey: webhookApiKey,
    });
    expect(first.processingStatus).toBe("PROCESSED");
    expect(first.trackingPointsCreated).toBe(2);
    expect(trackingRepo.points).toHaveLength(2);

    const second = await service.handle({
      requestId: "req-2",
      rawBody,
      apiKey: webhookApiKey,
    });
    expect(second.duplicate).toBe(true);
    expect(trackingRepo.points).toHaveLength(2);
  });

  it("deduplicates repeated scans via providerEventId", async () => {
    await seedShiprocketBooked();
    const rawBody = buildPayload({
      scans: [
        {
          date: "2026-03-28 10:00:00",
          activity: "Picked up",
          location: "Delhi",
          status: "IN TRANSIT",
          status_id: 17,
        },
      ],
    });

    await service.handle({ requestId: "req-1", rawBody, apiKey: webhookApiKey });
    await service.handle({
      requestId: "req-2",
      rawBody: JSON.stringify({
        ...JSON.parse(rawBody),
        current_timestamp: "2026-03-28 11:00:00",
      }),
      apiKey: webhookApiKey,
    });

    expect(trackingRepo.points).toHaveLength(1);
  });

  it("ignores unmatched deliveries without creating tracking points", async () => {
    const result = await service.handle({
      requestId: "req",
      rawBody: buildPayload({ sr_order_id: "99999999" }),
      apiKey: webhookApiKey,
    });
    expect(result.processingStatus).toBe("IGNORED");
    expect(result.reason).toBe("delivery_not_found");
    expect(trackingRepo.points).toHaveLength(0);
  });

  it("ignores ambiguous delivery matches", async () => {
    const first = await seedShiprocketBooked({ providerOrderId: "16161616" });
    const orchestrationRepo = new InMemoryOrchestrationRepository();
    const providerRepo = new InMemoryProviderRepository();
    const seeded2 = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      customerId,
    });
    await deliveryRepo.transitionStatus({
      deliveryId: seeded2.deliveryId,
      expectedFromStatuses: ["OPTION_READY"],
      toStatus: "BOOKING",
      source: "BOOKING",
      reason: "test",
    });
    const booking2 = await bookingRepo.createBookingAttempt({
      deliveryId: seeded2.deliveryId,
      attemptNumber: 1,
      orchestrationRequestId: seeded2.orchestrationRequestId,
      orchestrationOptionId: seeded2.selectedOptionId,
      providerId: seeded2.providerId,
      providerServiceId: null,
      providerCode: "SHIPROCKET",
      providerServiceCode: "HYPERLOCAL",
      correlationReference: `${seeded2.deliveryReference}-BOOKING-2`,
      quotedAmount: 150,
      quotedCurrency: "INR",
      providerQuoteId: "Q2",
      quoteSnapshot: {
        amount: 150,
        currency: "INR",
        quotedAt: new Date().toISOString(),
        providerMetadata: { shiprocketAwbCode: "SR999999999IN" },
      },
      requestId: "req",
    });
    await bookingRepo.finalizeBooking({
      bookingId: booking2.id,
      status: "BOOKED",
      providerOrderId: "16161616",
      providerReference: "222",
      bookedAmount: 150,
      bookedCurrency: "INR",
      bookedAt: new Date(),
    });

    const result = await service.handle({
      requestId: "req",
      rawBody: buildPayload({
        awb: "SR123456789IN",
        sr_order_id: "16161616",
      }),
      apiKey: webhookApiKey,
    });

    expect(result.processingStatus).toBe("IGNORED");
    expect(result.reason).toBe("delivery_ambiguous");
    expect(first.deliveryId).not.toBe(seeded2.deliveryId);
    expect(trackingRepo.points).toHaveLength(0);
  });

  it("rejects malformed payloads before persistence", async () => {
    await expect(
      service.handle({
        requestId: "req",
        rawBody: "{not-json",
        apiKey: webhookApiKey,
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR });
    expect(webhookRepo.events.size).toBe(0);
  });

  it("does not mark delivery DELIVERED from tracking webhook", async () => {
    const seeded = await seedShiprocketBooked();
    await deliveryRepo.transitionStatus({
      deliveryId: seeded.deliveryId,
      expectedFromStatuses: ["BOOKED"],
      toStatus: "IN_TRANSIT",
      source: "TRACKING",
      reason: "test",
    });

    await service.handle({
      requestId: "req",
      rawBody: buildPayload({
        scans: [
          {
            date: "2026-03-29 18:00:00",
            status: "Delivered",
            activity: "Delivered",
            location: "Customer",
            status_id: 7,
          },
        ],
      }),
      apiKey: webhookApiKey,
    });

    const delivery = await deliveryRepo.findById(seeded.deliveryId);
    expect(delivery?.status).toBe("IN_TRANSIT");
  });

  it("does not bypass pickup OTP from picked-up tracking webhook", async () => {
    const seeded = await seedShiprocketBooked();
    await deliveryRepo.transitionStatus({
      deliveryId: seeded.deliveryId,
      expectedFromStatuses: ["BOOKED"],
      toStatus: "PICKUP_OTP_PENDING",
      source: "OTP",
      reason: "test",
    });

    await service.handle({
      requestId: "req",
      rawBody: buildPayload({
        scans: [
          {
            date: "2026-03-28 10:00:00",
            status: "picked up",
            activity: "Pickup",
            location: "Delhi",
            status_id: 6,
          },
        ],
      }),
      apiKey: webhookApiKey,
    });

    const delivery = await deliveryRepo.findById(seeded.deliveryId);
    expect(delivery?.status).toBe("PICKUP_OTP_PENDING");
  });

  it("skips forward lifecycle for return events but still stores tracking", async () => {
    const seeded = await seedShiprocketBooked();
    await deliveryRepo.transitionStatus({
      deliveryId: seeded.deliveryId,
      expectedFromStatuses: ["BOOKED"],
      toStatus: "PICKED_UP",
      source: "OTP",
      reason: "test",
    });

    await service.handle({
      requestId: "req",
      rawBody: buildPayload({
        is_return: true,
        scans: [
          {
            date: "2026-03-28 16:00:00",
            status: "IN TRANSIT",
            activity: "Return in transit",
            location: "Hub",
            status_id: 17,
          },
        ],
      }),
      apiKey: webhookApiKey,
    });

    expect(trackingRepo.points).toHaveLength(1);
    const delivery = await deliveryRepo.findById(seeded.deliveryId);
    expect(delivery?.status).toBe("PICKED_UP");
  });

  it("stores provider event time separately from webhook receipt time", async () => {
    await seedShiprocketBooked();
    await service.handle({
      requestId: "req-1",
      rawBody: buildPayload({
        scans: [
          {
            date: "2026-03-28 08:00:00",
            status: "IN TRANSIT",
            activity: "In transit",
            location: "Hub",
            status_id: 17,
          },
        ],
      }),
      apiKey: webhookApiKey,
    });

    const point = trackingRepo.points[0]!;
    expect(point.providerTimestamp).not.toBeNull();
    expect(point.receivedAt.getTime()).toBeGreaterThanOrEqual(
      point.providerTimestamp!.getTime() - 60_000,
    );
    expect(point.metadata?.webhookReceivedAt).toBeDefined();
  });

  it("concurrent duplicate webhook bodies do not duplicate tracking points", async () => {
    await seedShiprocketBooked();
    const rawBody = buildPayload();
    const [first, second] = await Promise.all([
      service.handle({ requestId: "req-a", rawBody, apiKey: webhookApiKey }),
      service.handle({ requestId: "req-b", rawBody, apiKey: webhookApiKey }),
    ]);

    expect(trackingRepo.points).toHaveLength(2);
    const processedCount = [first, second].filter(
      (result) => result.processingStatus === "PROCESSED",
    ).length;
    expect(processedCount).toBe(1);
    expect(
      [first, second].some((result) => result.reason === "processing_in_progress"),
    ).toBe(true);
  });

  it("retries FAILED webhooks without duplicating persisted scans", async () => {
    await seedShiprocketBooked();
    const rawBody = buildPayload();
    const normalized = normalizeShiprocketTrackingWebhook(JSON.parse(rawBody));
    if (normalized.action !== "events") {
      throw new Error("expected events");
    }
    const failingScanId = normalized.scans[1]!.providerEventId;

    const tracking = new TrackingService(
      deliveryRepo,
      trackingRepo,
      new DeliveryLifecycleService(deliveryRepo),
    );
    const originalIngest = tracking.ingestFromWebhook.bind(tracking);
    tracking.ingestFromWebhook = async (input) => {
      if (input.event.providerEventId === failingScanId) {
        throw new Error("transient failure");
      }
      return originalIngest(input);
    };

    const flakyService = new ShiprocketProviderWebhookService(
      webhookRepo,
      new TestShiprocketDeliveryLinkResolver(bookingRepo),
      deliveryRepo,
      tracking,
    );

    await expect(
      flakyService.handle({ requestId: "req-fail", rawBody, apiKey: webhookApiKey }),
    ).rejects.toThrow("transient failure");
    expect(trackingRepo.points).toHaveLength(1);

    tracking.ingestFromWebhook = originalIngest;
    await flakyService.handle({
      requestId: "req-retry",
      rawBody,
      apiKey: webhookApiKey,
    });
    expect(trackingRepo.points).toHaveLength(2);
  });

  it("acknowledges unmatched deliveries with IGNORED (HTTP 200, no provider HTTP retry)", async () => {
    const result = await service.handle({
      requestId: "req-unmatched",
      rawBody: buildPayload({ sr_order_id: "40404040" }),
      apiKey: webhookApiKey,
    });
    expect(result.processingStatus).toBe("IGNORED");
    expect(result.reason).toBe("delivery_not_found");
    expect(trackingRepo.points).toHaveLength(0);
  });

  it("marks webhook events FAILED and rethrows on processing errors", async () => {
    await seedShiprocketBooked();
    const failingTracking = {
      ingestFromWebhook: vi.fn(async () => {
        throw new Error("db unavailable");
      }),
    } as unknown as TrackingService;
    const failingService = new ShiprocketProviderWebhookService(
      webhookRepo,
      new TestShiprocketDeliveryLinkResolver(bookingRepo),
      deliveryRepo,
      failingTracking,
    );

    await expect(
      failingService.handle({
        requestId: "req",
        rawBody: buildPayload(),
        apiKey: webhookApiKey,
      }),
    ).rejects.toThrow("db unavailable");

    const stored = [...webhookRepo.events.values()][0];
    expect(stored?.processingStatus).toBe("FAILED");
  });

  it("does not leak secrets in normalized stored events", async () => {
    await seedShiprocketBooked();
    await service.handle({
      requestId: "req",
      rawBody: buildPayload({ apiKey: webhookApiKey }),
      apiKey: webhookApiKey,
    });
    const stored = [...webhookRepo.events.values()][0];
    expect(JSON.stringify(stored)).not.toContain(webhookApiKey);
  });

  it("reclaims stale webhook processing leases", async () => {
    const repo = new InMemoryProviderWebhookEventRepository();
    const event = await repo.createReceivedEvent({
      providerCode: "SHIPROCKET",
      eventType: "TRACKING",
      providerEventKey: "SHIPROCKET:TRACKING:test-lease",
      providerOrderId: "1",
      providerDeliveryId: null,
      eventDatetime: new Date(),
      signatureVerified: true,
      payloadHash: "hash",
      payload: {},
      normalizedEvent: {},
    });

    expect(
      await repo.tryAcquireProcessingLease({
        eventId: event.id,
        leaseToken: "worker-a",
      }),
    ).toBe(true);

    const leased = repo.events.get(event.providerEventKey)!;
    leased.updatedAt = new Date(
      Date.now() - PROVIDER_WEBHOOK_PROCESSING_LEASE_STALE_MS - 1_000,
    );
    repo.events.set(event.providerEventKey, leased);

    expect(
      await repo.tryAcquireProcessingLease({
        eventId: event.id,
        leaseToken: "worker-b",
      }),
    ).toBe(true);
  });
});
