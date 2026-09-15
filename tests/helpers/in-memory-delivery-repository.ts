import { randomUUID } from "node:crypto";
import type {
  DeliveryCompliance,
  DeliveryDrop,
  DeliveryHandlingRequirement,
  DeliveryPackage,
  DeliveryPackagePhoto,
  DeliveryPickup,
  DeliverySchedule,
  DeliveryStatus,
  DeliveryStatusEvent,
  Prisma,
  StatusEventSource,
} from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";
import { DELIVERY_REFERENCE_PREFIX } from "../../src/modules/delivery/delivery.constants.js";
import type {
  CreateDeliveryPersistInput,
  DeliveryListFilters,
  DeliveryWithRelations,
  IDeliveryRepository,
  IdempotencyRecord,
} from "../../src/modules/delivery/delivery.repository.js";
import { toDeliveryDetailDto } from "../../src/modules/delivery/delivery.repository.js";
import type { DeliveryDetailDto } from "../../src/modules/delivery/delivery.types.js";

type StoredDelivery = DeliveryWithRelations & {
  statusEvents: DeliveryStatusEvent[];
};

export class InMemoryDeliveryRepository implements IDeliveryRepository {
  deliveries: StoredDelivery[] = [];
  idempotency: IdempotencyRecord[] = [];
  private referenceSeq = 1000;
  private failNextCreate = false;

  failOnNextCreate(): void {
    this.failNextCreate = true;
  }

  async withTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const deliverySnap = this.deliveries.map((item) => this.cloneDelivery(item));
    const idemSnap = this.idempotency.map((item) => ({ ...item }));
    const seqSnap = this.referenceSeq;
    try {
      return await fn({} as Prisma.TransactionClient);
    } catch (error) {
      this.deliveries = deliverySnap;
      this.idempotency = idemSnap;
      this.referenceSeq = seqSnap;
      throw error;
    }
  }

  private cloneDelivery(delivery: StoredDelivery): StoredDelivery {
    return {
      ...delivery,
      pickup: { ...delivery.pickup },
      drop: { ...delivery.drop },
      package: {
        ...delivery.package,
        weightKg: new PrismaNamespace.Decimal(delivery.package.weightKg.toString()),
        lengthCm:
          delivery.package.lengthCm == null
            ? null
            : new PrismaNamespace.Decimal(delivery.package.lengthCm.toString()),
        widthCm:
          delivery.package.widthCm == null
            ? null
            : new PrismaNamespace.Decimal(delivery.package.widthCm.toString()),
        heightCm:
          delivery.package.heightCm == null
            ? null
            : new PrismaNamespace.Decimal(delivery.package.heightCm.toString()),
        photos: delivery.package.photos.map((photo) => ({ ...photo })),
      },
      schedule: { ...delivery.schedule },
      compliance: { ...delivery.compliance },
      requirements: delivery.requirements.map((item) => ({ ...item })),
      statusEvents: delivery.statusEvents.map((item) => ({ ...item })),
    };
  }

  async nextReference(): Promise<string> {
    const value = this.referenceSeq++;
    return `${DELIVERY_REFERENCE_PREFIX}-${value}`;
  }

  async createDelivery(
    input: CreateDeliveryPersistInput,
  ): Promise<DeliveryWithRelations> {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new Error("simulated create failure");
    }

    const now = new Date();
    const deliveryId = randomUUID();
    const packageId = randomUUID();

    const pickup: DeliveryPickup = {
      id: randomUUID(),
      deliveryId,
      addressText: input.pickup.addressText,
      contactName: input.pickup.contactName,
      contactPhone: input.pickup.contactPhone,
      instructions: input.pickup.instructions,
    };

    const drop: DeliveryDrop = {
      id: randomUUID(),
      deliveryId,
      addressText: input.drop.addressText,
      contactName: input.drop.contactName,
      contactPhone: input.drop.contactPhone,
      instructions: input.drop.instructions,
    };

    const photos: DeliveryPackagePhoto[] = input.package.photos.map((photo) => ({
      id: randomUUID(),
      packageId,
      objectKey: photo.objectKey,
      storageProvider: photo.storageProvider,
      mimeType: photo.mimeType,
      fileSizeBytes: photo.fileSizeBytes,
      createdAt: now,
    }));

    const pkg: DeliveryPackage & { photos: DeliveryPackagePhoto[] } = {
      id: packageId,
      deliveryId,
      packageType: input.package.packageType,
      description: input.package.description,
      weightKg: new PrismaNamespace.Decimal(input.package.weightKg),
      lengthCm:
        input.package.lengthCm == null
          ? null
          : new PrismaNamespace.Decimal(input.package.lengthCm),
      widthCm:
        input.package.widthCm == null
          ? null
          : new PrismaNamespace.Decimal(input.package.widthCm),
      heightCm:
        input.package.heightCm == null
          ? null
          : new PrismaNamespace.Decimal(input.package.heightCm),
      sizeTier: input.package.sizeTier,
      quantity: input.package.quantity,
      photos,
    };

    const schedule: DeliverySchedule = {
      id: randomUUID(),
      deliveryId,
      mode: input.schedule.mode,
      timezone: input.schedule.timezone,
      scheduledAt: input.schedule.scheduledAt,
      windowStart: input.schedule.windowStart,
      windowEnd: input.schedule.windowEnd,
    };

    const compliance: DeliveryCompliance = {
      id: randomUUID(),
      deliveryId,
      accepted: true,
      acceptedAt: input.complianceAcceptedAt,
    };

    const requirements: DeliveryHandlingRequirement[] = input.requirements.map(
      (requirement) => ({
        id: randomUUID(),
        deliveryId,
        requirement,
      }),
    );

    const statusEvent: DeliveryStatusEvent = {
      id: randomUUID(),
      deliveryId,
      fromStatus: null,
      toStatus: "CREATED" as DeliveryStatus,
      source: "SYSTEM",
      reason: "Delivery created",
      metadata: null,
      createdAt: now,
    };

    const delivery: StoredDelivery = {
      id: deliveryId,
      reference: input.reference,
      customerId: input.customerId,
      status: "CREATED",
      specialInstructions: input.specialInstructions,
      createdAt: now,
      updatedAt: now,
      pickup,
      drop,
      package: pkg,
      schedule,
      compliance,
      requirements,
      statusEvents: [statusEvent],
    };

    this.deliveries.push(delivery);
    return delivery;
  }

  async findByIdForCustomer(
    deliveryId: string,
    customerId: string,
  ): Promise<DeliveryWithRelations | null> {
    return (
      this.deliveries.find(
        (item) => item.id === deliveryId && item.customerId === customerId,
      ) ?? null
    );
  }

  async findById(deliveryId: string): Promise<DeliveryWithRelations | null> {
    return this.deliveries.find((item) => item.id === deliveryId) ?? null;
  }

  private applyListFilters(
    items: StoredDelivery[],
    filters?: DeliveryListFilters,
  ): StoredDelivery[] {
    return items.filter((item) => {
      if (filters?.status && item.status !== filters.status) {
        return false;
      }
      if (filters?.from && item.createdAt.getTime() < filters.from.getTime()) {
        return false;
      }
      if (filters?.to && item.createdAt.getTime() > filters.to.getTime()) {
        return false;
      }
      if (
        filters?.reference &&
        !item.reference.toLowerCase().includes(filters.reference.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }

  async listForCustomer(
    customerId: string,
    page: number,
    limit: number,
    filters?: DeliveryListFilters,
  ): Promise<{ items: DeliveryWithRelations[]; total: number }> {
    const filtered = this.applyListFilters(
      this.deliveries.filter((item) => item.customerId === customerId),
      filters,
    ).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = filtered.length;
    const items = filtered.slice((page - 1) * limit, page * limit);
    return { items, total };
  }

  async listAll(
    page: number,
    limit: number,
    filters?: DeliveryListFilters,
  ): Promise<{ items: DeliveryWithRelations[]; total: number }> {
    const filtered = this.applyListFilters([...this.deliveries], filters).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    return {
      items: filtered.slice((page - 1) * limit, page * limit),
      total: filtered.length,
    };
  }

  async findStatusEvents(deliveryId: string): Promise<DeliveryStatusEvent[]> {
    const delivery = this.deliveries.find((item) => item.id === deliveryId);
    if (!delivery) {
      return [];
    }
    return [...delivery.statusEvents].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }

  async findIdempotency(
    customerId: string,
    key: string,
  ): Promise<IdempotencyRecord | null> {
    return (
      this.idempotency.find(
        (item) => item.customerId === customerId && item.key === key,
      ) ?? null
    );
  }

  async saveIdempotency(input: {
    customerId: string;
    key: string;
    requestHash: string;
    deliveryId: string;
    responsePayload: DeliveryDetailDto;
  }): Promise<void> {
    this.idempotency.push({ ...input });
  }

  async transitionStatus(input: {
    deliveryId: string;
    expectedFromStatuses: DeliveryStatus[];
    toStatus: DeliveryStatus;
    source: StatusEventSource;
    reason: string;
    metadata?: Record<string, unknown>;
  }): Promise<DeliveryWithRelations | null> {
    const delivery = this.deliveries.find((item) => item.id === input.deliveryId);
    if (!delivery || !input.expectedFromStatuses.includes(delivery.status)) {
      return null;
    }

    const fromStatus = delivery.status;
    delivery.status = input.toStatus;
    delivery.updatedAt = new Date();
    delivery.statusEvents.push({
      id: randomUUID(),
      deliveryId: delivery.id,
      fromStatus,
      toStatus: input.toStatus,
      source: input.source,
      reason: input.reason,
      metadata: input.metadata ?? null,
      createdAt: new Date(),
    });
    return delivery;
  }
}

export { toDeliveryDetailDto };
