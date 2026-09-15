import type {
  Delivery,
  DeliveryCompliance,
  DeliveryDrop,
  DeliveryHandlingRequirement,
  DeliveryPackage,
  DeliveryPackagePhoto,
  DeliveryPickup,
  DeliverySchedule,
  DeliveryStatus,
  DeliveryStatusEvent,
  HandlingRequirement,
  PackageSizeTier,
  PackageType,
  Prisma,
  ScheduleMode,
  StatusEventSource,
} from "@prisma/client";
import { getPrismaClient } from "../../config/database.js";
import { DELIVERY_REFERENCE_PREFIX } from "./delivery.constants.js";
import type { DeliveryDetailDto, NormalizedCreateDelivery } from "./delivery.types.js";
import { decimalToNumber } from "./delivery.types.js";

export type AuthDbClient =
  | Prisma.TransactionClient
  | ReturnType<typeof getPrismaClient>;

export type DeliveryWithRelations = Delivery & {
  pickup: DeliveryPickup;
  drop: DeliveryDrop;
  package: DeliveryPackage & { photos: DeliveryPackagePhoto[] };
  schedule: DeliverySchedule;
  compliance: DeliveryCompliance;
  requirements: DeliveryHandlingRequirement[];
};

export type CreateDeliveryPersistInput = NormalizedCreateDelivery & {
  customerId: string;
  reference: string;
};

export type IdempotencyRecord = {
  customerId: string;
  key: string;
  requestHash: string;
  deliveryId: string;
  responsePayload: DeliveryDetailDto;
};

export type DeliveryListFilters = {
  status?: DeliveryStatus;
  from?: Date;
  to?: Date;
  reference?: string;
};

export interface IDeliveryRepository {
  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
  nextReference(client?: AuthDbClient): Promise<string>;
  createDelivery(
    input: CreateDeliveryPersistInput,
    client?: AuthDbClient,
  ): Promise<DeliveryWithRelations>;
  findByIdForCustomer(
    deliveryId: string,
    customerId: string,
  ): Promise<DeliveryWithRelations | null>;
  findById(deliveryId: string): Promise<DeliveryWithRelations | null>;
  listForCustomer(
    customerId: string,
    page: number,
    limit: number,
    filters?: DeliveryListFilters,
  ): Promise<{ items: DeliveryWithRelations[]; total: number }>;
  listAll(
    page: number,
    limit: number,
    filters?: DeliveryListFilters,
  ): Promise<{ items: DeliveryWithRelations[]; total: number }>;
  findStatusEvents(deliveryId: string): Promise<DeliveryStatusEvent[]>;
  findIdempotency(
    customerId: string,
    key: string,
  ): Promise<IdempotencyRecord | null>;
  saveIdempotency(
    input: {
      customerId: string;
      key: string;
      requestHash: string;
      deliveryId: string;
      responsePayload: DeliveryDetailDto;
    },
    client?: AuthDbClient,
  ): Promise<void>;
  transitionStatus(
    input: {
      deliveryId: string;
      expectedFromStatuses: DeliveryStatus[];
      toStatus: DeliveryStatus;
      source: StatusEventSource;
      reason: string;
      metadata?: Record<string, unknown>;
    },
    client?: AuthDbClient,
  ): Promise<DeliveryWithRelations | null>;
}

const deliveryInclude = {
  pickup: true,
  drop: true,
  package: { include: { photos: true } },
  schedule: true,
  compliance: true,
  requirements: true,
} as const;

function buildListWhere(
  base: Prisma.DeliveryWhereInput,
  filters?: DeliveryListFilters,
): Prisma.DeliveryWhereInput {
  if (!filters) {
    return base;
  }

  const where: Prisma.DeliveryWhereInput = { ...base };
  if (filters.status) {
    where.status = filters.status;
  }
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }
  if (filters.reference) {
    where.reference = {
      contains: filters.reference,
      mode: "insensitive",
    };
  }
  return where;
}

export function toDeliveryDetailDto(
  delivery: DeliveryWithRelations,
): DeliveryDetailDto {
  return {
    id: delivery.id,
    reference: delivery.reference,
    status: delivery.status,
    pickup: {
      addressText: delivery.pickup.addressText,
      contactName: delivery.pickup.contactName,
      contactPhone: delivery.pickup.contactPhone,
      instructions: delivery.pickup.instructions,
    },
    drop: {
      addressText: delivery.drop.addressText,
      contactName: delivery.drop.contactName,
      contactPhone: delivery.drop.contactPhone,
      instructions: delivery.drop.instructions,
    },
    package: {
      packageType: delivery.package.packageType,
      description: delivery.package.description,
      weightKg: decimalToNumber(delivery.package.weightKg),
      lengthCm:
        delivery.package.lengthCm == null
          ? null
          : decimalToNumber(delivery.package.lengthCm),
      widthCm:
        delivery.package.widthCm == null
          ? null
          : decimalToNumber(delivery.package.widthCm),
      heightCm:
        delivery.package.heightCm == null
          ? null
          : decimalToNumber(delivery.package.heightCm),
      sizeTier: delivery.package.sizeTier,
      quantity: delivery.package.quantity,
      photos: delivery.package.photos.map((photo) => ({
        objectKey: photo.objectKey,
        storageProvider: photo.storageProvider,
        mimeType: photo.mimeType,
        fileSizeBytes: photo.fileSizeBytes,
      })),
    },
    requirements: delivery.requirements.map((item) => item.requirement),
    specialInstructions: delivery.specialInstructions,
    schedule: {
      mode: delivery.schedule.mode,
      timezone: delivery.schedule.timezone,
      scheduledAt: delivery.schedule.scheduledAt?.toISOString() ?? null,
      windowStart: delivery.schedule.windowStart?.toISOString() ?? null,
      windowEnd: delivery.schedule.windowEnd?.toISOString() ?? null,
    },
    compliance: {
      accepted: delivery.compliance.accepted,
      acceptedAt: delivery.compliance.acceptedAt.toISOString(),
    },
    createdAt: delivery.createdAt.toISOString(),
    updatedAt: delivery.updatedAt.toISOString(),
  };
}

export class PrismaDeliveryRepository implements IDeliveryRepository {
  private db(client?: AuthDbClient) {
    return client ?? getPrismaClient();
  }

  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return getPrismaClient().$transaction(fn);
  }

  async nextReference(client?: AuthDbClient): Promise<string> {
    const rows = await this.db(client).$queryRaw<Array<{ nextval: bigint | number }>>`
      SELECT nextval('delivery_reference_seq') AS nextval
    `;
    const value = rows[0]?.nextval;
    if (value === undefined || value === null) {
      throw new Error("Failed to allocate delivery reference");
    }
    return `${DELIVERY_REFERENCE_PREFIX}-${value.toString()}`;
  }

  async createDelivery(
    input: CreateDeliveryPersistInput,
    client?: AuthDbClient,
  ): Promise<DeliveryWithRelations> {
    const db = this.db(client);
    return db.delivery.create({
      data: {
        reference: input.reference,
        customerId: input.customerId,
        status: "CREATED",
        specialInstructions: input.specialInstructions,
        pickup: {
          create: {
            addressText: input.pickup.addressText,
            contactName: input.pickup.contactName,
            contactPhone: input.pickup.contactPhone,
            instructions: input.pickup.instructions,
          },
        },
        drop: {
          create: {
            addressText: input.drop.addressText,
            contactName: input.drop.contactName,
            contactPhone: input.drop.contactPhone,
            instructions: input.drop.instructions,
          },
        },
        package: {
          create: {
            packageType: input.package.packageType as PackageType,
            description: input.package.description,
            weightKg: input.package.weightKg,
            lengthCm: input.package.lengthCm,
            widthCm: input.package.widthCm,
            heightCm: input.package.heightCm,
            sizeTier: input.package.sizeTier as PackageSizeTier,
            quantity: input.package.quantity,
            photos: {
              create: input.package.photos.map((photo) => ({
                objectKey: photo.objectKey,
                storageProvider: photo.storageProvider,
                mimeType: photo.mimeType,
                fileSizeBytes: photo.fileSizeBytes,
              })),
            },
          },
        },
        schedule: {
          create: {
            mode: input.schedule.mode as ScheduleMode,
            timezone: input.schedule.timezone,
            scheduledAt: input.schedule.scheduledAt,
            windowStart: input.schedule.windowStart,
            windowEnd: input.schedule.windowEnd,
          },
        },
        compliance: {
          create: {
            accepted: true,
            acceptedAt: input.complianceAcceptedAt,
          },
        },
        requirements: {
          create: input.requirements.map((requirement) => ({
            requirement: requirement as HandlingRequirement,
          })),
        },
        statusEvents: {
          create: {
            fromStatus: null,
            toStatus: "CREATED",
            source: "SYSTEM",
            reason: "Delivery created",
          },
        },
      },
      include: deliveryInclude,
    }) as Promise<DeliveryWithRelations>;
  }

  findByIdForCustomer(
    deliveryId: string,
    customerId: string,
  ): Promise<DeliveryWithRelations | null> {
    return getPrismaClient().delivery.findFirst({
      where: { id: deliveryId, customerId },
      include: deliveryInclude,
    }) as Promise<DeliveryWithRelations | null>;
  }

  findById(deliveryId: string): Promise<DeliveryWithRelations | null> {
    return getPrismaClient().delivery.findUnique({
      where: { id: deliveryId },
      include: deliveryInclude,
    }) as Promise<DeliveryWithRelations | null>;
  }

  async listForCustomer(
    customerId: string,
    page: number,
    limit: number,
    filters?: DeliveryListFilters,
  ): Promise<{ items: DeliveryWithRelations[]; total: number }> {
    const where = buildListWhere({ customerId }, filters);
    const [total, items] = await Promise.all([
      getPrismaClient().delivery.count({ where }),
      getPrismaClient().delivery.findMany({
        where,
        include: deliveryInclude,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { items: items as DeliveryWithRelations[], total };
  }

  async listAll(
    page: number,
    limit: number,
    filters?: DeliveryListFilters,
  ): Promise<{ items: DeliveryWithRelations[]; total: number }> {
    const where = buildListWhere({}, filters);
    const [total, items] = await Promise.all([
      getPrismaClient().delivery.count({ where }),
      getPrismaClient().delivery.findMany({
        where,
        include: deliveryInclude,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { items: items as DeliveryWithRelations[], total };
  }

  async findStatusEvents(deliveryId: string): Promise<DeliveryStatusEvent[]> {
    return getPrismaClient().deliveryStatusEvent.findMany({
      where: { deliveryId },
      orderBy: { createdAt: "asc" },
    });
  }

  async findIdempotency(
    customerId: string,
    key: string,
  ): Promise<IdempotencyRecord | null> {
    const row = await getPrismaClient().deliveryIdempotencyKey.findUnique({
      where: { customerId_key: { customerId, key } },
    });
    if (!row) return null;
    return {
      customerId: row.customerId,
      key: row.key,
      requestHash: row.requestHash,
      deliveryId: row.deliveryId,
      responsePayload: row.responsePayload as DeliveryDetailDto,
    };
  }

  async saveIdempotency(
    input: {
      customerId: string;
      key: string;
      requestHash: string;
      deliveryId: string;
      responsePayload: DeliveryDetailDto;
    },
    client?: AuthDbClient,
  ): Promise<void> {
    await this.db(client).deliveryIdempotencyKey.create({
      data: {
        customerId: input.customerId,
        key: input.key,
        requestHash: input.requestHash,
        deliveryId: input.deliveryId,
        responsePayload: input.responsePayload as Prisma.InputJsonValue,
      },
    });
  }

  async transitionStatus(
    input: {
      deliveryId: string;
      expectedFromStatuses: DeliveryStatus[];
      toStatus: DeliveryStatus;
      source: StatusEventSource;
      reason: string;
      metadata?: Record<string, unknown>;
    },
    client?: AuthDbClient,
  ): Promise<DeliveryWithRelations | null> {
    const runTransition = async (
      tx: Prisma.TransactionClient,
    ): Promise<DeliveryWithRelations | null> => {
      const current = await tx.delivery.findFirst({
        where: {
          id: input.deliveryId,
          status: { in: input.expectedFromStatuses },
        },
        select: { id: true, status: true },
      });
      if (!current) {
        return null;
      }

      const updated = await tx.delivery.updateMany({
        where: {
          id: input.deliveryId,
          status: current.status,
        },
        data: {
          status: input.toStatus,
          updatedAt: new Date(),
        },
      });
      if (updated.count === 0) {
        return null;
      }

      await tx.deliveryStatusEvent.create({
        data: {
          deliveryId: input.deliveryId,
          fromStatus: current.status,
          toStatus: input.toStatus,
          source: input.source,
          reason: input.reason,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
        },
      });

      return tx.delivery.findUniqueOrThrow({
        where: { id: input.deliveryId },
        include: deliveryInclude,
      }) as Promise<DeliveryWithRelations>;
    };

    if (client) {
      return runTransition(client as Prisma.TransactionClient);
    }

    return getPrismaClient().$transaction(runTransition);
  }
}

export const deliveryRepository = new PrismaDeliveryRepository();

// Silence unused type import if StatusEvent not referenced directly
export type { DeliveryStatusEvent };
