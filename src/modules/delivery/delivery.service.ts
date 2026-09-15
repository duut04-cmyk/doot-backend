import { logger } from "../../config/logger.js";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import {
  deliveryRepository,
  toDeliveryDetailDto,
  type IDeliveryRepository,
} from "./delivery.repository.js";
import type { CreateDeliveryBody, ListDeliveriesQuery } from "./delivery.schema.js";
import { hashDeliveryCreateRequest } from "./delivery.schema.js";
import { deriveSizeTier } from "./delivery.types.js";
import type {
  CreateDeliveryResult,
  GetDeliveryResult,
  ListDeliveriesResult,
  NormalizedCreateDelivery,
} from "./delivery.types.js";

export class DeliveryService {
  constructor(private readonly repository: IDeliveryRepository = deliveryRepository) {}

  async createDelivery(input: {
    customerId: string;
    body: CreateDeliveryBody;
    idempotencyKey: string;
    requestHash?: string;
  }): Promise<CreateDeliveryResult> {
    const requestHash =
      input.requestHash ?? hashDeliveryCreateRequest(input.body);

    const existing = await this.repository.findIdempotency(
      input.customerId,
      input.idempotencyKey,
    );
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new AppError(
          "Idempotency key was reused with a different request payload.",
          {
            statusCode: 409,
            code: ErrorCodes.IDEMPOTENCY_CONFLICT,
          },
        );
      }
      return { success: true, data: existing.responsePayload };
    }

    const normalized = this.normalizeCreateInput(input.body);

    const created = await this.repository.withTransaction(async (tx) => {
      const reference = await this.repository.nextReference(tx);
      const delivery = await this.repository.createDelivery(
        {
          ...normalized,
          customerId: input.customerId,
          reference,
        },
        tx,
      );
      const dto = toDeliveryDetailDto(delivery);
      await this.repository.saveIdempotency(
        {
          customerId: input.customerId,
          key: input.idempotencyKey,
          requestHash,
          deliveryId: delivery.id,
          responsePayload: dto,
        },
        tx,
      );
      return dto;
    });

    logger.info(
      {
        deliveryId: created.id,
        reference: created.reference,
        customerId: input.customerId,
      },
      "delivery_created",
    );

    return { success: true, data: created };
  }

  async listDeliveries(input: {
    customerId: string;
    role: "CUSTOMER" | "ADMIN";
    query: ListDeliveriesQuery;
  }): Promise<ListDeliveriesResult> {
    const { page, limit, status, from, to, reference } = input.query;
    const filters = {
      status,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      reference,
    };
    const result =
      input.role === "ADMIN"
        ? await this.repository.listAll(page, limit, filters)
        : await this.repository.listForCustomer(
            input.customerId,
            page,
            limit,
            filters,
          );

    return {
      success: true,
      data: {
        items: result.items.map((delivery) => {
          const detail = toDeliveryDetailDto(delivery);
          return {
            id: detail.id,
            reference: detail.reference,
            status: detail.status,
            pickup: {
              addressText: detail.pickup.addressText,
              contactName: detail.pickup.contactName,
            },
            drop: {
              addressText: detail.drop.addressText,
              contactName: detail.drop.contactName,
            },
            packageType: detail.package.packageType,
            weightKg: detail.package.weightKg,
            sizeTier: detail.package.sizeTier,
            schedule: {
              mode: detail.schedule.mode,
              scheduledAt: detail.schedule.scheduledAt,
              timezone: detail.schedule.timezone,
            },
            createdAt: detail.createdAt,
            updatedAt: detail.updatedAt,
          };
        }),
        page,
        limit,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / limit)),
      },
    };
  }

  async getDelivery(input: {
    deliveryId: string;
    customerId: string;
    role: "CUSTOMER" | "ADMIN";
  }): Promise<GetDeliveryResult> {
    const delivery =
      input.role === "ADMIN"
        ? await this.repository.findById(input.deliveryId)
        : await this.repository.findByIdForCustomer(
            input.deliveryId,
            input.customerId,
          );

    if (!delivery) {
      // Do not leak existence across customers.
      throw new AppError("Delivery not found.", {
        statusCode: 404,
        code: ErrorCodes.DELIVERY_NOT_FOUND,
      });
    }

    return { success: true, data: toDeliveryDetailDto(delivery) };
  }

  private normalizeCreateInput(body: CreateDeliveryBody): NormalizedCreateDelivery {
    const weightKg = body.package.weightKg;
    const sizeTier = deriveSizeTier(weightKg);

    const windowStart =
      body.schedule.mode === "SCHEDULED" && body.schedule.windowStart
        ? new Date(body.schedule.windowStart)
        : null;
    const windowEnd =
      body.schedule.mode === "SCHEDULED" && body.schedule.windowEnd
        ? new Date(body.schedule.windowEnd)
        : null;

    return {
      pickup: {
        addressText: body.pickup.addressText,
        contactName: body.pickup.contactName,
        contactPhoneCountryCode: body.pickup.contactPhone.countryCode,
        contactPhoneNumber: body.pickup.contactPhone.number,
        instructions: body.pickup.instructions ?? null,
      },
      drop: {
        addressText: body.drop.addressText,
        contactName: body.drop.contactName,
        contactPhoneCountryCode: body.drop.contactPhone.countryCode,
        contactPhoneNumber: body.drop.contactPhone.number,
        instructions: body.drop.instructions ?? null,
      },
      package: {
        packageType: body.package.packageType,
        description: body.package.description ?? null,
        weightKg,
        lengthCm: body.package.lengthCm ?? null,
        widthCm: body.package.widthCm ?? null,
        heightCm: body.package.heightCm ?? null,
        sizeTier,
        quantity: body.package.quantity ?? 1,
        photos: (body.package.photos ?? []).map((photo) => ({
          objectKey: photo.objectKey,
          storageProvider: photo.storageProvider ?? "PENDING",
          mimeType: photo.mimeType ?? null,
          fileSizeBytes: photo.fileSizeBytes ?? null,
        })),
      },
      requirements: body.requirements ?? [],
      specialInstructions: body.specialInstructions ?? null,
      schedule: {
        mode: body.schedule.mode,
        timezone: body.schedule.timezone,
        scheduledAt: windowStart,
        windowStart,
        windowEnd,
      },
      compliance: {
        accepted: true,
        acceptedAt: new Date(),
      },
    };
  }
}

export const deliveryService = new DeliveryService();
