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

export interface IProviderWebhookEventRepository {
  createReceivedEvent(
    input: CreateProviderWebhookEventInput,
  ): Promise<ProviderWebhookEventDto>;
  findByProviderEventKey(
    providerEventKey: string,
  ): Promise<ProviderWebhookEventDto | null>;
  markProcessed(
    eventId: string,
    input: {
      processingStatus: ProviderWebhookProcessingStatus;
      processingError?: string | null;
    },
  ): Promise<ProviderWebhookEventDto>;
}

export class ProviderWebhookEventRepository
  implements IProviderWebhookEventRepository
{
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
        const existing = await this.findByProviderEventKey(
          input.providerEventKey,
        );
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

  async markProcessed(
    eventId: string,
    input: {
      processingStatus: ProviderWebhookProcessingStatus;
      processingError?: string | null;
    },
  ): Promise<ProviderWebhookEventDto> {
    const prisma = getPrismaClient();
    return prisma.providerWebhookEvent.update({
      where: { id: eventId },
      data: {
        processingStatus: input.processingStatus,
        processingError: input.processingError ?? null,
        processedAt: new Date(),
      },
    });
  }
}

export const providerWebhookEventRepository =
  new ProviderWebhookEventRepository();
