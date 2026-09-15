import { randomUUID } from "node:crypto";
import type { FeedbackIssueTag, FeedbackPositiveTag, Prisma } from "@prisma/client";
import { AppError } from "../../src/core/errors/app-error.js";
import { ErrorCodes } from "../../src/core/errors/error-codes.js";
import type { IFeedbackRepository } from "../../src/modules/feedback/feedback.repository.js";
import type { DeliveryFeedbackDto } from "../../src/modules/feedback/feedback.types.js";
import type { InMemoryDeliveryRepository } from "./in-memory-delivery-repository.js";

export class InMemoryFeedbackRepository implements IFeedbackRepository {
  feedback: DeliveryFeedbackDto[] = [];

  constructor(private readonly deliveryRepo: InMemoryDeliveryRepository) {}

  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return fn({} as Prisma.TransactionClient);
  }

  async findByDeliveryId(deliveryId: string): Promise<DeliveryFeedbackDto | null> {
    return this.feedback.find((item) => item.deliveryId === deliveryId) ?? null;
  }

  async createForDeliveredDelivery(
    input: {
      deliveryId: string;
      customerId: string;
      positiveTags: FeedbackPositiveTag[];
      issueTags: FeedbackIssueTag[];
      comment: string | null;
    },
    _client?: Prisma.TransactionClient,
  ): Promise<DeliveryFeedbackDto> {
    const delivery = this.deliveryRepo.deliveries.find(
      (item) =>
        item.id === input.deliveryId &&
        item.customerId === input.customerId &&
        item.status === "DELIVERED",
    );
    if (!delivery) {
      throw new AppError("Feedback is not allowed for this delivery.", {
        statusCode: 409,
        code: ErrorCodes.FEEDBACK_NOT_ALLOWED,
      });
    }

    if (this.feedback.some((item) => item.deliveryId === input.deliveryId)) {
      throw new AppError("Feedback has already been submitted for this delivery.", {
        statusCode: 409,
        code: ErrorCodes.FEEDBACK_ALREADY_SUBMITTED,
      });
    }

    const now = new Date();
    const row: DeliveryFeedbackDto = {
      id: randomUUID(),
      deliveryId: input.deliveryId,
      positiveTags: input.positiveTags,
      issueTags: input.issueTags,
      comment: input.comment,
      createdAt: now,
      updatedAt: now,
    };
    this.feedback.push(row);
    return row;
  }
}
