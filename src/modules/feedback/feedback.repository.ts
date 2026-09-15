import type { FeedbackIssueTag, FeedbackPositiveTag, Prisma } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";
import { getPrismaClient } from "../../config/database.js";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import type { DeliveryFeedbackDto } from "./feedback.types.js";

export type FeedbackDbClient =
  | Prisma.TransactionClient
  | ReturnType<typeof getPrismaClient>;

function mapRow(row: {
  id: string;
  deliveryId: string;
  customerId: string;
  positiveTags: FeedbackPositiveTag[];
  issueTags: FeedbackIssueTag[];
  comment: string | null;
  createdAt: Date;
  updatedAt: Date;
}): DeliveryFeedbackDto {
  return {
    id: row.id,
    deliveryId: row.deliveryId,
    positiveTags: row.positiveTags,
    issueTags: row.issueTags,
    comment: row.comment,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface IFeedbackRepository {
  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
  findByDeliveryId(deliveryId: string): Promise<DeliveryFeedbackDto | null>;
  createForDeliveredDelivery(
    input: {
      deliveryId: string;
      customerId: string;
      positiveTags: FeedbackPositiveTag[];
      issueTags: FeedbackIssueTag[];
      comment: string | null;
    },
    client?: FeedbackDbClient,
  ): Promise<DeliveryFeedbackDto>;
}

export class PrismaFeedbackRepository implements IFeedbackRepository {
  private db(client?: FeedbackDbClient) {
    return client ?? getPrismaClient();
  }

  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return getPrismaClient().$transaction(fn);
  }

  async findByDeliveryId(deliveryId: string): Promise<DeliveryFeedbackDto | null> {
    const row = await getPrismaClient().deliveryFeedback.findUnique({
      where: { deliveryId },
    });
    return row ? mapRow(row) : null;
  }

  async createForDeliveredDelivery(
    input: {
      deliveryId: string;
      customerId: string;
      positiveTags: FeedbackPositiveTag[];
      issueTags: FeedbackIssueTag[];
      comment: string | null;
    },
    client?: FeedbackDbClient,
  ): Promise<DeliveryFeedbackDto> {
    const db = this.db(client);
    const delivery = await db.delivery.findFirst({
      where: {
        id: input.deliveryId,
        customerId: input.customerId,
        status: "DELIVERED",
      },
      select: { id: true },
    });
    if (!delivery) {
      throw new AppError("Feedback is not allowed for this delivery.", {
        statusCode: 409,
        code: ErrorCodes.FEEDBACK_NOT_ALLOWED,
      });
    }

    try {
      const row = await db.deliveryFeedback.create({
        data: {
          deliveryId: input.deliveryId,
          customerId: input.customerId,
          positiveTags: input.positiveTags,
          issueTags: input.issueTags,
          comment: input.comment,
        },
      });
      return mapRow(row);
    } catch (error) {
      if (
        error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new AppError("Feedback has already been submitted for this delivery.", {
          statusCode: 409,
          code: ErrorCodes.FEEDBACK_ALREADY_SUBMITTED,
        });
      }
      throw error;
    }
  }
}

export const feedbackRepository = new PrismaFeedbackRepository();
