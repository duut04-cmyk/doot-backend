import type { Prisma, TrackingPointSource } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";
import { getPrismaClient } from "../../config/database.js";

export type TrackingPointDto = {
  id: string;
  deliveryId: string;
  providerBookingId: string;
  providerId: string;
  providerEventId: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  providerTimestamp: Date | null;
  receivedAt: Date;
  eta: Date | null;
  providerStatus: string | null;
  normalizedStatus: string | null;
  trackingUrl: string | null;
  source: TrackingPointSource;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

export interface ITrackingRepository {
  findLatestByDeliveryId(deliveryId: string): Promise<TrackingPointDto | null>;
  listByDeliveryId(
    deliveryId: string,
    page: number,
    limit: number,
  ): Promise<{ items: TrackingPointDto[]; total: number }>;
  findByProviderEvent(
    providerId: string,
    providerEventId: string,
  ): Promise<TrackingPointDto | null>;
  createPoint(
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
    client?: Prisma.TransactionClient,
  ): Promise<TrackingPointDto>;
}

function mapRow(row: {
  id: string;
  deliveryId: string;
  providerBookingId: string;
  providerId: string;
  providerEventId: string | null;
  latitude: PrismaNamespace.Decimal | null;
  longitude: PrismaNamespace.Decimal | null;
  accuracyMeters: number | null;
  providerTimestamp: Date | null;
  receivedAt: Date;
  eta: Date | null;
  providerStatus: string | null;
  normalizedStatus: string | null;
  trackingUrl: string | null;
  source: TrackingPointSource;
  metadata: unknown;
  createdAt: Date;
}): TrackingPointDto {
  return {
    id: row.id,
    deliveryId: row.deliveryId,
    providerBookingId: row.providerBookingId,
    providerId: row.providerId,
    providerEventId: row.providerEventId,
    latitude: row.latitude == null ? null : Number(row.latitude.toString()),
    longitude: row.longitude == null ? null : Number(row.longitude.toString()),
    accuracyMeters: row.accuracyMeters,
    providerTimestamp: row.providerTimestamp,
    receivedAt: row.receivedAt,
    eta: row.eta,
    providerStatus: row.providerStatus,
    normalizedStatus: row.normalizedStatus,
    trackingUrl: row.trackingUrl,
    source: row.source,
    metadata: row.metadata as Record<string, unknown> | null,
    createdAt: row.createdAt,
  };
}

export class PrismaTrackingRepository implements ITrackingRepository {
  async findLatestByDeliveryId(
    deliveryId: string,
  ): Promise<TrackingPointDto | null> {
    const row = await getPrismaClient().deliveryTrackingPoint.findFirst({
      where: { deliveryId },
      orderBy: { receivedAt: "desc" },
    });
    return row ? mapRow(row) : null;
  }

  async listByDeliveryId(
    deliveryId: string,
    page: number,
    limit: number,
  ): Promise<{ items: TrackingPointDto[]; total: number }> {
    const where = { deliveryId };
    const [total, rows] = await Promise.all([
      getPrismaClient().deliveryTrackingPoint.count({ where }),
      getPrismaClient().deliveryTrackingPoint.findMany({
        where,
        orderBy: { receivedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { items: rows.map(mapRow), total };
  }

  async findByProviderEvent(
    providerId: string,
    providerEventId: string,
  ): Promise<TrackingPointDto | null> {
    const row = await getPrismaClient().deliveryTrackingPoint.findFirst({
      where: { providerId, providerEventId },
    });
    return row ? mapRow(row) : null;
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
    client?: Prisma.TransactionClient,
  ): Promise<TrackingPointDto> {
    const db = client ?? getPrismaClient();
    const row = await db.deliveryTrackingPoint.create({
      data: {
        deliveryId: input.deliveryId,
        providerBookingId: input.providerBookingId,
        providerId: input.providerId,
        providerEventId: input.providerEventId ?? null,
        latitude:
          input.latitude == null
            ? null
            : new PrismaNamespace.Decimal(input.latitude),
        longitude:
          input.longitude == null
            ? null
            : new PrismaNamespace.Decimal(input.longitude),
        accuracyMeters: input.accuracyMeters ?? null,
        providerTimestamp: input.providerTimestamp ?? null,
        receivedAt: input.receivedAt,
        eta: input.eta ?? null,
        providerStatus: input.providerStatus ?? null,
        normalizedStatus: input.normalizedStatus ?? null,
        trackingUrl: input.trackingUrl ?? null,
        source: input.source,
        metadata: input.metadata
          ? (input.metadata as Prisma.InputJsonValue)
          : undefined,
      },
    });
    return mapRow(row);
  }
}

export const trackingRepository = new PrismaTrackingRepository();
