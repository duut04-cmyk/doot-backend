import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PROVIDER_WEBHOOK_PROCESSING_LEASE_STALE_MS,
  ProviderWebhookLeaseConflictError,
} from "../src/modules/provider/provider.webhook.repository.js";
import { InMemoryProviderWebhookEventRepository } from "./helpers/in-memory-provider-webhook-event-repository.js";

describe("Provider webhook lease ownership", () => {
  it("markProcessed requires matching lease on RECEIVED rows", async () => {
    const repo = new InMemoryProviderWebhookEventRepository();
    const event = await repo.createReceivedEvent({
      providerCode: "SHIPROCKET",
      eventType: "TRACKING",
      providerEventKey: "SHIPROCKET:TRACKING:lease-owner",
      providerOrderId: "1",
      providerDeliveryId: null,
      eventDatetime: new Date(),
      signatureVerified: true,
      payloadHash: "hash",
      payload: {},
      normalizedEvent: {},
    });

    await repo.tryAcquireProcessingLease({ eventId: event.id, leaseToken: "worker-b" });

    await expect(
      repo.markProcessed(event.id, {
        processingStatus: "PROCESSED",
        leaseToken: "worker-a",
      }),
    ).rejects.toBeInstanceOf(ProviderWebhookLeaseConflictError);

    const finalized = await repo.markProcessed(event.id, {
      processingStatus: "PROCESSED",
      leaseToken: "worker-b",
    });
    expect(finalized.processingStatus).toBe("PROCESSED");
    expect(finalized.processingError).toBeNull();
  });

  it("stale worker cannot finalize after lease reclaim", async () => {
    const repo = new InMemoryProviderWebhookEventRepository();
    const event = await repo.createReceivedEvent({
      providerCode: "SHIPROCKET",
      eventType: "TRACKING",
      providerEventKey: "SHIPROCKET:TRACKING:stale-worker",
      providerOrderId: "1",
      providerDeliveryId: null,
      eventDatetime: new Date(),
      signatureVerified: true,
      payloadHash: "hash-2",
      payload: {},
      normalizedEvent: {},
    });

    await repo.tryAcquireProcessingLease({ eventId: event.id, leaseToken: "worker-a" });
    const row = [...repo.events.values()].find((item) => item.id === event.id)!;
    row.updatedAt = new Date(
      Date.now() - PROVIDER_WEBHOOK_PROCESSING_LEASE_STALE_MS - 1_000,
    );
    repo.events.set(row.providerEventKey, row);

    expect(
      await repo.tryAcquireProcessingLease({
        eventId: event.id,
        leaseToken: "worker-b",
      }),
    ).toBe(true);

    await repo.markProcessed(event.id, {
      processingStatus: "PROCESSED",
      leaseToken: "worker-b",
    });

    await expect(
      repo.markProcessed(event.id, {
        processingStatus: "FAILED",
        processingError: "late worker",
        leaseToken: "worker-a",
      }),
    ).rejects.toBeInstanceOf(ProviderWebhookLeaseConflictError);
  });

  it("FAILED retry finalizes without lease token", async () => {
    const repo = new InMemoryProviderWebhookEventRepository();
    const event = await repo.createReceivedEvent({
      providerCode: "SHIPROCKET",
      eventType: "TRACKING",
      providerEventKey: `SHIPROCKET:TRACKING:failed-${randomUUID()}`,
      providerOrderId: "1",
      providerDeliveryId: null,
      eventDatetime: new Date(),
      signatureVerified: true,
      payloadHash: "hash-3",
      payload: {},
      normalizedEvent: {},
    });

    await repo.tryAcquireProcessingLease({ eventId: event.id, leaseToken: "worker-a" });
    await repo.markProcessed(event.id, {
      processingStatus: "FAILED",
      processingError: "transient",
      leaseToken: "worker-a",
    });

    const retried = await repo.markProcessed(event.id, {
      processingStatus: "PROCESSED",
      leaseToken: null,
    });
    expect(retried.processingStatus).toBe("PROCESSED");
  });
});
