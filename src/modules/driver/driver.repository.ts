import type {
  DriverAssignmentStatus,
  OperationalDataSource,
  Prisma,
} from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";
import { getPrismaClient } from "../../config/database.js";
import type { DriverAssignmentDto } from "./driver.types.js";

export type DriverDbClient =
  | Prisma.TransactionClient
  | ReturnType<typeof getPrismaClient>;

function mapRow(row: {
  id: string;
  deliveryId: string;
  providerBookingId: string;
  providerId: string;
  providerDriverId: string | null;
  driverName: string | null;
  driverPhone: string | null;
  driverPhotoUrl: string | null;
  providerRating: PrismaNamespace.Decimal | null;
  vehicleType: string | null;
  vehicleNumber: string | null;
  assignedAt: Date | null;
  status: DriverAssignmentStatus;
  source: OperationalDataSource;
  providerStatus: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): DriverAssignmentDto {
  return {
    id: row.id,
    deliveryId: row.deliveryId,
    providerBookingId: row.providerBookingId,
    providerId: row.providerId,
    providerDriverId: row.providerDriverId,
    driverName: row.driverName,
    driverPhone: row.driverPhone,
    driverPhotoUrl: row.driverPhotoUrl,
    providerRating:
      row.providerRating == null ? null : Number(row.providerRating.toString()),
    vehicleType: row.vehicleType,
    vehicleNumber: row.vehicleNumber,
    assignedAt: row.assignedAt,
    status: row.status,
    source: row.source,
    providerStatus: row.providerStatus,
    metadata: row.metadata as Record<string, unknown> | null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface IDriverRepository {
  findActiveByDeliveryId(deliveryId: string): Promise<DriverAssignmentDto | null>;
  findLatestByDeliveryId(deliveryId: string): Promise<DriverAssignmentDto | null>;
  upsertAssignment(
    input: {
      deliveryId: string;
      providerBookingId: string;
      providerId: string;
      providerDriverId: string | null;
      driverName: string | null;
      driverPhone: string | null;
      driverPhotoUrl: string | null;
      providerRating: number | null;
      vehicleType: string | null;
      vehicleNumber: string | null;
      assignedAt: Date | null;
      status: DriverAssignmentStatus;
      source: OperationalDataSource;
      providerStatus: string | null;
      metadata?: Record<string, unknown> | null;
    },
    client?: DriverDbClient,
  ): Promise<DriverAssignmentDto>;
}

export class PrismaDriverRepository implements IDriverRepository {
  private db(client?: DriverDbClient) {
    return client ?? getPrismaClient();
  }

  async findActiveByDeliveryId(
    deliveryId: string,
  ): Promise<DriverAssignmentDto | null> {
    const row = await getPrismaClient().driverAssignment.findFirst({
      where: { deliveryId, status: "ASSIGNED" },
      orderBy: { updatedAt: "desc" },
    });
    return row ? mapRow(row) : null;
  }

  async findLatestByDeliveryId(
    deliveryId: string,
  ): Promise<DriverAssignmentDto | null> {
    const row = await getPrismaClient().driverAssignment.findFirst({
      where: { deliveryId },
      orderBy: { updatedAt: "desc" },
    });
    return row ? mapRow(row) : null;
  }

  async upsertAssignment(
    input: {
      deliveryId: string;
      providerBookingId: string;
      providerId: string;
      providerDriverId: string | null;
      driverName: string | null;
      driverPhone: string | null;
      driverPhotoUrl: string | null;
      providerRating: number | null;
      vehicleType: string | null;
      vehicleNumber: string | null;
      assignedAt: Date | null;
      status: DriverAssignmentStatus;
      source: OperationalDataSource;
      providerStatus: string | null;
      metadata?: Record<string, unknown> | null;
    },
    client?: DriverDbClient,
  ): Promise<DriverAssignmentDto> {
    const db = this.db(client);
    const existing = await db.driverAssignment.findFirst({
      where: { deliveryId: input.deliveryId, status: "ASSIGNED" },
    });

    const data = {
      providerBookingId: input.providerBookingId,
      providerId: input.providerId,
      providerDriverId: input.providerDriverId,
      driverName: input.driverName,
      driverPhone: input.driverPhone,
      driverPhotoUrl: input.driverPhotoUrl,
      providerRating:
        input.providerRating == null
          ? null
          : new PrismaNamespace.Decimal(input.providerRating),
      vehicleType: input.vehicleType,
      vehicleNumber: input.vehicleNumber,
      assignedAt: input.assignedAt,
      status: input.status,
      source: input.source,
      providerStatus: input.providerStatus,
      metadata: input.metadata
        ? (input.metadata as Prisma.InputJsonValue)
        : undefined,
    };

    if (existing) {
      const row = await db.driverAssignment.update({
        where: { id: existing.id },
        data,
      });
      return mapRow(row);
    }

    const row = await db.driverAssignment.create({
      data: {
        deliveryId: input.deliveryId,
        ...data,
      },
    });
    return mapRow(row);
  }
}

export const driverRepository = new PrismaDriverRepository();
