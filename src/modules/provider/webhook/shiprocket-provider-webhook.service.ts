import type { ProviderWebhookProcessingStatus } from "@prisma/client";
import { env, requireShiprocketWebhookApiKey } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import { AppError } from "../../../core/errors/app-error.js";
import { ErrorCodes } from "../../../core/errors/error-codes.js";
import {
  deliveryRepository,
  type IDeliveryRepository,
} from "../../delivery/delivery.repository.js";
import {
  trackingService,
  type TrackingService,
} from "../../tracking/tracking.service.js";
import { SHIPROCKET_PROVIDER_CODE } from "../adapters/shiprocket/shiprocket.constants.js";
import {
  hashShiprocketWebhookPayload,
  normalizeShiprocketTrackingWebhook,
  SHIPROCKET_WEBHOOK_MAX_BODY_BYTES,
  shiprocketWebhookProviderEventKey,
} from "../adapters/shiprocket/shiprocket-webhook.normalize.js";
import { verifyShiprocketWebhookApiKey } from "../adapters/shiprocket/shiprocket-webhook.verify.js";
import type { NormalizedProviderWebhookEvent } from "../contracts/webhook.js";
import {
  prismaProviderDeliveryLinkResolver,
  type PrismaProviderDeliveryLinkResolver,
} from "../provider.delivery-link.prisma.js";
import {
  ProviderWebhookDuplicateEventError,
  ProviderWebhookLeaseConflictError,
  providerWebhookEventRepository,
  type IProviderWebhookEventRepository,
} from "../provider.webhook.repository.js";

export type ShiprocketWebhookHandleResult = {
  processingStatus: ProviderWebhookProcessingStatus;
  duplicate: boolean;
  trackingPointsCreated: number;
  reason?: string;
};

function sanitizeShiprocketWebhookPayloadForStorage(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  const copy = { ...(payload as Record<string, unknown>) };
  delete copy.apiKey;
  delete copy.api_key;
  delete copy["x-api-key"];
  return copy;
}

export class ShiprocketProviderWebhookService {
  constructor(
    private readonly webhookEvents: IProviderWebhookEventRepository = providerWebhookEventRepository,
    private readonly deliveryLink: Pick<
      PrismaProviderDeliveryLinkResolver,
      "resolveShiprocketTrackingWebhook"
    > = prismaProviderDeliveryLinkResolver,
    private readonly deliveryRepo: IDeliveryRepository = deliveryRepository,
    private readonly tracking: TrackingService = trackingService,
  ) {}

  assertEnabledAndAuthenticated(apiKey: string | undefined): void {
    if (!env.SHIPROCKET_WEBHOOK_ENABLED) {
      throw new AppError("Shiprocket webhooks are disabled.", {
        statusCode: 404,
        code: ErrorCodes.NOT_FOUND,
      });
    }

    const configuredKey = requireShiprocketWebhookApiKey();
    const valid = verifyShiprocketWebhookApiKey({
      suppliedKey: apiKey,
      configuredKey,
    });
    if (!valid) {
      throw new AppError("Invalid Shiprocket webhook API key.", {
        statusCode: 401,
        code: ErrorCodes.INVALID_PROVIDER_WEBHOOK_SIGNATURE,
      });
    }
  }

  /**
   * Ingest Shiprocket tracking webhooks.
   *
   * Unmatched (`delivery_not_found`) and ambiguous deliveries are marked IGNORED and
   * acknowledged with HTTP 200 — the provider will not be prompted to retry via the
   * normal HTTP response mechanism. Reconciliation relies on later webhooks, polling, or ops.
   */
  async handle(input: {
    requestId: string;
    rawBody: string;
    apiKey: string | undefined;
  }): Promise<ShiprocketWebhookHandleResult> {
    this.assertEnabledAndAuthenticated(input.apiKey);

    if (Buffer.byteLength(input.rawBody, "utf8") > SHIPROCKET_WEBHOOK_MAX_BODY_BYTES) {
      throw new AppError("Shiprocket webhook payload too large.", {
        statusCode: 413,
        code: ErrorCodes.VALIDATION_ERROR,
      });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(input.rawBody) as unknown;
    } catch {
      throw new AppError("Malformed Shiprocket webhook payload.", {
        statusCode: 400,
        code: ErrorCodes.VALIDATION_ERROR,
      });
    }

    const normalized = normalizeShiprocketTrackingWebhook(payload);
    const payloadHash = hashShiprocketWebhookPayload(input.rawBody);
    const providerEventKey = shiprocketWebhookProviderEventKey(payloadHash);
    const receivedAt = new Date().toISOString();

    if (normalized.action === "reject") {
      throw new AppError("Invalid Shiprocket webhook payload.", {
        statusCode: 400,
        code: ErrorCodes.VALIDATION_ERROR,
      });
    }

    const stubEvent = this.buildStoredNormalizedEvent({
      receivedAt,
      normalized,
      providerEventKey,
    });

    const payloadForStorage = sanitizeShiprocketWebhookPayloadForStorage(payload);

    let eventRecord = await this.receiveOrReuseEvent({
      providerEventKey,
      payload: payloadForStorage,
      payloadHash,
      normalizedEvent: stubEvent,
      signatureVerified: true,
      providerOrderId:
        normalized.action === "events" ? normalized.providerOrderId : null,
      providerAwb: normalized.action === "events" ? normalized.providerAwb : null,
      eventType:
        normalized.action === "events" ? normalized.eventType : "TRACKING_IGNORED",
    });

    if (
      eventRecord.processingStatus === "PROCESSED" ||
      eventRecord.processingStatus === "IGNORED"
    ) {
      return {
        processingStatus: eventRecord.processingStatus,
        duplicate: true,
        trackingPointsCreated: 0,
        reason: "duplicate_provider_event_key",
      };
    }

    if (normalized.action === "ignore") {
      let activeLeaseToken: string | null = null;
      if (eventRecord.processingStatus === "RECEIVED") {
        const leased = await this.webhookEvents.tryAcquireProcessingLease({
          eventId: eventRecord.id,
          leaseToken: input.requestId,
        });
        if (!leased) {
          return this.duplicateInProgressResponse(providerEventKey);
        }
        activeLeaseToken = input.requestId;
      }

      try {
        eventRecord = await this.webhookEvents.markProcessed(eventRecord.id, {
          processingStatus: "IGNORED",
          processingError: normalized.reason,
          leaseToken: activeLeaseToken,
        });
      } catch (error) {
        if (error instanceof ProviderWebhookLeaseConflictError) {
          return this.duplicateInProgressResponse(providerEventKey);
        }
        throw error;
      }
      logger.info(
        { requestId: input.requestId, reason: normalized.reason },
        "shiprocket_webhook_ignored",
      );
      return {
        processingStatus: "IGNORED",
        duplicate: false,
        trackingPointsCreated: 0,
        reason: normalized.reason,
      };
    }

    let activeLeaseToken: string | null = null;
    if (eventRecord.processingStatus === "RECEIVED") {
      const leased = await this.webhookEvents.tryAcquireProcessingLease({
        eventId: eventRecord.id,
        leaseToken: input.requestId,
      });
      if (!leased) {
        return this.duplicateInProgressResponse(providerEventKey);
      }
      activeLeaseToken = input.requestId;
    }
    // FAILED rows are retried without a lease; concurrent FAILED retries may overlap
    // (per-scan providerEventId dedup limits duplicate tracking points).

    try {
      const link = await this.deliveryLink.resolveShiprocketTrackingWebhook({
        awb: normalized.providerAwb,
        srOrderId: normalized.srOrderId,
        orderId: normalized.orderId,
      });

      if (link.outcome === "not_found") {
        eventRecord = await this.webhookEvents.markProcessed(eventRecord.id, {
          processingStatus: "IGNORED",
          processingError: "delivery_not_found",
          leaseToken: activeLeaseToken,
        });
        logger.warn({ requestId: input.requestId }, "shiprocket_webhook_unmatched");
        return {
          processingStatus: "IGNORED",
          duplicate: false,
          trackingPointsCreated: 0,
          reason: "delivery_not_found",
        };
      }

      if (link.outcome === "ambiguous") {
        eventRecord = await this.webhookEvents.markProcessed(eventRecord.id, {
          processingStatus: "IGNORED",
          processingError: "delivery_ambiguous",
          leaseToken: activeLeaseToken,
        });
        logger.warn(
          {
            requestId: input.requestId,
            deliveryIds: link.deliveryIds,
          },
          "shiprocket_webhook_ambiguous",
        );
        return {
          processingStatus: "IGNORED",
          duplicate: false,
          trackingPointsCreated: 0,
          reason: "delivery_ambiguous",
        };
      }

      let trackingPointsCreated = 0;
      for (const scan of normalized.scans) {
        const delivery = await this.deliveryRepo.findById(link.deliveryId);
        if (!delivery) {
          throw new AppError("Delivery not found after link resolution.", {
            statusCode: 404,
            code: ErrorCodes.DELIVERY_NOT_FOUND,
          });
        }

        const event: NormalizedProviderWebhookEvent = {
          providerCode: SHIPROCKET_PROVIDER_CODE,
          providerEventId: scan.providerEventId,
          eventType: normalized.eventType,
          providerReference: null,
          providerBookingId: normalized.providerOrderId,
          status: scan.status,
          eventTimestamp: scan.eventTimestamp,
          receivedAt,
          driver: null,
          tracking: {
            status: scan.status,
            latitude: null,
            longitude: null,
            eta: null,
            trackingUrl: null,
            metadata: {
              ...scan.metadata,
              skipForwardDeliveryLifecycle: scan.skipForwardDeliveryLifecycle,
            },
          },
          metadata: scan.metadata,
        };

        const point = await this.tracking.ingestFromWebhook({
          deliveryId: link.deliveryId,
          deliveryStatus: delivery.status,
          providerBookingId: link.bookingId,
          providerId: link.providerId,
          event,
        });
        if (point) {
          trackingPointsCreated += 1;
        }
      }

      eventRecord = await this.webhookEvents.markProcessed(eventRecord.id, {
        processingStatus: "PROCESSED",
        leaseToken: activeLeaseToken,
      });

      logger.info(
        {
          requestId: input.requestId,
          deliveryId: link.deliveryId,
          trackingPointsCreated,
        },
        "shiprocket_webhook_processed",
      );

      return {
        processingStatus: "PROCESSED",
        duplicate: false,
        trackingPointsCreated,
      };
    } catch (error) {
      if (error instanceof ProviderWebhookLeaseConflictError) {
        return this.duplicateInProgressResponse(providerEventKey);
      }
      const message =
        error instanceof Error ? error.message : "shiprocket_webhook_processing_failed";
      try {
        await this.webhookEvents.markProcessed(eventRecord.id, {
          processingStatus: "FAILED",
          processingError: message,
          leaseToken: activeLeaseToken,
        });
      } catch (finalizeError) {
        if (finalizeError instanceof ProviderWebhookLeaseConflictError) {
          logger.warn(
            { requestId: input.requestId, providerEventKey },
            "shiprocket_webhook_failed_lease_lost",
          );
          return this.duplicateInProgressResponse(providerEventKey);
        }
        throw finalizeError;
      }
      logger.error(
        { requestId: input.requestId, err: error },
        "shiprocket_webhook_failed",
      );
      throw error;
    }
  }

  private buildStoredNormalizedEvent(input: {
    receivedAt: string;
    normalized: ReturnType<typeof normalizeShiprocketTrackingWebhook>;
    providerEventKey: string;
  }): NormalizedProviderWebhookEvent {
    const scanCount =
      input.normalized.action === "events" ? input.normalized.scans.length : 0;
    return {
      providerCode: SHIPROCKET_PROVIDER_CODE,
      providerEventId: input.providerEventKey,
      eventType:
        input.normalized.action === "events"
          ? input.normalized.eventType
          : "TRACKING_IGNORED",
      providerReference: null,
      providerBookingId:
        input.normalized.action === "events" ? input.normalized.providerOrderId : null,
      status: null,
      eventTimestamp: null,
      receivedAt: input.receivedAt,
      driver: null,
      tracking: null,
      metadata: {
        payloadSummary:
          input.normalized.action === "events"
            ? {
                scanCount,
                isReturn: input.normalized.isReturn,
                providerAwb: input.normalized.providerAwb,
              }
            : { reason: input.normalized.reason },
      },
    };
  }

  private async duplicateInProgressResponse(
    providerEventKey: string,
  ): Promise<ShiprocketWebhookHandleResult> {
    const row = await this.webhookEvents.findByProviderEventKey(providerEventKey);
    if (row?.processingStatus === "PROCESSED" || row?.processingStatus === "IGNORED") {
      return {
        processingStatus: row.processingStatus,
        duplicate: true,
        trackingPointsCreated: 0,
        reason: "duplicate_provider_event_key",
      };
    }
    return {
      processingStatus: row?.processingStatus ?? "RECEIVED",
      duplicate: true,
      trackingPointsCreated: 0,
      reason: "processing_in_progress",
    };
  }

  private async receiveOrReuseEvent(input: {
    providerEventKey: string;
    payload: unknown;
    payloadHash: string;
    normalizedEvent: NormalizedProviderWebhookEvent;
    signatureVerified: boolean;
    providerOrderId: string | null;
    providerAwb: string | null;
    eventType: string;
  }) {
    try {
      return await this.webhookEvents.createReceivedEvent({
        providerCode: SHIPROCKET_PROVIDER_CODE,
        eventType: input.eventType,
        providerEventKey: input.providerEventKey,
        providerOrderId: input.providerOrderId,
        providerDeliveryId: input.providerAwb,
        eventDatetime: new Date(input.normalizedEvent.receivedAt),
        signatureVerified: input.signatureVerified,
        payloadHash: input.payloadHash,
        payload: input.payload,
        normalizedEvent: input.normalizedEvent,
      });
    } catch (error) {
      if (error instanceof ProviderWebhookDuplicateEventError) {
        return error.existingEvent;
      }
      throw error;
    }
  }
}

export const shiprocketProviderWebhookService = new ShiprocketProviderWebhookService();
