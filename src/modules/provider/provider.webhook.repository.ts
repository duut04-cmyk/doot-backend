import type { ProviderWebhookProcessingStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { getPrismaClient } from "../../config/database.js";
import type {
  CreateProviderWebhookEventInput,
  ProviderWebhookEventDto,
} from "./provider.webhook.types.js";

export class ProviderWebhookDuplicateEventError extends Error {
  readonly existingEvent: ProviderWebhookEventDto;

  constructor(existingEvent: ProviderWebhookEventDto) {
    super("Provider webhook event already exists.");
    this.name = "ProviderWebhookDuplicateEventError";
    this.existingEvent = existingEvent;
  }
}

export class ProviderWebhookLeaseConflictError extends Error {
  constructor() {
    super("Provider webhook processing lease is not held by this worker.");
    this.name = "ProviderWebhookLeaseConflictError";
  }
}

export const PROVIDER_WEBHOOK_PROCESSING_LEASE_PREFIX = "lease:";

export function formatProviderWebhookProcessingLease(leaseToken: string): string {
  return `${PROVIDER_WEBHOOK_PROCESSING_LEASE_PREFIX}${leaseToken}`;
}

/** Stale processing leases may be reclaimed (crash between lease and markProcessed). */
export const PROVIDER_WEBHOOK_PROCESSING_LEASE_STALE_MS = 5 * 60 * 1000;

export interface IProviderWebhookEventRepository {
  createReceivedEvent(
    input: CreateProviderWebhookEventInput,
  ): Promise<ProviderWebhookEventDto>;
  findByProviderEventKey(
    providerEventKey: string,
  ): Promise<ProviderWebhookEventDto | null>;
  /**
   * Best-effort single-worker claim for RECEIVED rows (no PROCESSING enum / migration).
   * Uses processingError as a transient lease token.
   */
  tryAcquireProcessingLease(input: {
    eventId: string;
    leaseToken: string;
  }): Promise<boolean>;
  markProcessed(
    eventId: string,
    input: {
      processingStatus: ProviderWebhookProcessingStatus;
      processingError?: string | null;
      /** When set, row must be RECEIVED with this worker's lease. */
      leaseToken?: string | null;
    },
  ): Promise<ProviderWebhookEventDto>;
}

export class ProviderWebhookEventRepository implements IProviderWebhookEventRepository {
  async createReceivedEvent(
    input: CreateProviderWebhookEventInput,
  ): Promise<ProviderWebhookEventDto> {
    const prisma = getPrismaClient();
    try {
      return await prisma.providerWebhookEvent.create({
        data: {
          providerCode: input.providerCode,
          eventType: input.eventType,
          providerEventKey: input.providerEventKey,
          providerOrderId: input.providerOrderId,
          providerDeliveryId: input.providerDeliveryId,
          eventDatetime: input.eventDatetime,
          signatureVerified: input.signatureVerified,
          payloadHash: input.payloadHash,
          payload: input.payload as Prisma.InputJsonValue,
          normalizedEvent: input.normalizedEvent as Prisma.InputJsonValue,
          processingStatus: "RECEIVED",
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await this.findByProviderEventKey(input.providerEventKey);
        if (existing) {
          throw new ProviderWebhookDuplicateEventError(existing);
        }
      }
      throw error;
    }
  }

  async findByProviderEventKey(
    providerEventKey: string,
  ): Promise<ProviderWebhookEventDto | null> {
    const prisma = getPrismaClient();
    return prisma.providerWebhookEvent.findUnique({
      where: { providerEventKey },
    });
  }

  async tryAcquireProcessingLease(input: {
    eventId: string;
    leaseToken: string;
  }): Promise<boolean> {
    const prisma = getPrismaClient();
    const leaseValue = formatProviderWebhookProcessingLease(input.leaseToken);
    const fresh = await prisma.providerWebhookEvent.updateMany({
      where: {
        id: input.eventId,
        processingStatus: "RECEIVED",
        processingError: null,
      },
      data: {
        processingError: leaseValue,
      },
    });
    if (fresh.count === 1) {
      return true;
    }

    const staleBefore = new Date(
      Date.now() - PROVIDER_WEBHOOK_PROCESSING_LEASE_STALE_MS,
    );
    const reclaimed = await prisma.providerWebhookEvent.updateMany({
      where: {
        id: input.eventId,
        processingStatus: "RECEIVED",
        processingError: { startsWith: PROVIDER_WEBHOOK_PROCESSING_LEASE_PREFIX },
        updatedAt: { lt: staleBefore },
      },
      data: {
        processingError: leaseValue,
      },
    });
    return reclaimed.count === 1;
  }

  async markProcessed(
    eventId: string,
    input: {
      processingStatus: ProviderWebhookProcessingStatus;
      processingError?: string | null;
      leaseToken?: string | null;
    },
  ): Promise<ProviderWebhookEventDto> {
    const prisma = getPrismaClient();
    const data = {
      processingStatus: input.processingStatus,
      processingError: input.processingError ?? null,
      processedAt: new Date(),
    };

    if (input.leaseToken) {
      const result = await prisma.providerWebhookEvent.updateMany({
        where: {
          id: eventId,
          processingStatus: "RECEIVED",
          processingError: formatProviderWebhookProcessingLease(input.leaseToken),
        },
        data,
      });
      if (result.count !== 1) {
        throw new ProviderWebhookLeaseConflictError();
      }
    } else {
      const result = await prisma.providerWebhookEvent.updateMany({
        where: {
          id: eventId,
          processingStatus: "FAILED",
        },
        data,
      });
      if (result.count !== 1) {
        throw new ProviderWebhookLeaseConflictError();
      }
    }

    return prisma.providerWebhookEvent.findUniqueOrThrow({
      where: { id: eventId },
    });
  }
}

export const providerWebhookEventRepository = new ProviderWebhookEventRepository();
