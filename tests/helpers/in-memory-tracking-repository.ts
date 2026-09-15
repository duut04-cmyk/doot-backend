import { randomUUID } from "node:crypto";
import type { Prisma, TrackingPointSource } from "@prisma/client";
import type {
  ITrackingRepository,
  TrackingPointDto,
} from "../../src/modules/tracking/tracking.repository.js";

export class InMemoryTrackingRepository implements ITrackingRepository {
  points: TrackingPointDto[] = [];

  async findLatestByDeliveryId(
    deliveryId: string,
  ): Promise<TrackingPointDto | null> {
    return (
      this.points
        .filter((item) => item.deliveryId === deliveryId)
        .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())[0] ??
      null
    );
  }

  async listByDeliveryId(
    deliveryId: string,
    page: number,
    limit: number,
  ): Promise<{ items: TrackingPointDto[]; total: number }> {
    const filtered = this.points
      .filter((item) => item.deliveryId === deliveryId)
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
    return {
      items: filtered.slice((page - 1) * limit, page * limit),
      total: filtered.length,
    };
  }

  async findByProviderEvent(
    providerId: string,
    providerEventId: string,
  ): Promise<TrackingPointDto | null> {
    return (
      this.points.find(
        (item) =>
          item.providerId === providerId &&
          item.providerEventId === providerEventId,
      ) ?? null
    );
  }

  async createPoint(
    input: {
      deliveryId: string;
      providerBookingId: string;
      providerId: string;
      providerEventId?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      accuracyMeters?: number | null;
      providerTimestamp?: Date | null;
      receivedAt: Date;
      eta?: Date | null;
      providerStatus?: string | null;
      normalizedStatus?: string | null;
      trackingUrl?: string | null;
      source: TrackingPointSource;
      metadata?: Record<string, unknown> | null;
    },
    _client?: Prisma.TransactionClient,
  ): Promise<TrackingPointDto> {
    const row: TrackingPointDto = {
      id: randomUUID(),
      deliveryId: input.deliveryId,
      providerBookingId: input.providerBookingId,
      providerId: input.providerId,
      providerEventId: input.providerEventId ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      accuracyMeters: input.accuracyMeters ?? null,
      providerTimestamp: input.providerTimestamp ?? null,
      receivedAt: input.receivedAt,
      eta: input.eta ?? null,
      providerStatus: input.providerStatus ?? null,
      normalizedStatus: input.normalizedStatus ?? null,
      trackingUrl: input.trackingUrl ?? null,
      source: input.source,
      metadata: input.metadata ?? null,
      createdAt: new Date(),
    };
    this.points.push(row);
    return row;
  }
}
