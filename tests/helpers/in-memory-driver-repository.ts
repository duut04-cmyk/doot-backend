import { randomUUID } from "node:crypto";
import type {
  DriverAssignmentStatus,
  OperationalDataSource,
  Prisma,
} from "@prisma/client";
import type {
  DriverAssignmentDto,
  IDriverRepository,
} from "../../src/modules/driver/driver.repository.js";

export class InMemoryDriverRepository implements IDriverRepository {
  assignments: DriverAssignmentDto[] = [];

  async findActiveByDeliveryId(
    deliveryId: string,
  ): Promise<DriverAssignmentDto | null> {
    return (
      this.assignments
        .filter(
          (item) => item.deliveryId === deliveryId && item.status === "ASSIGNED",
        )
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null
    );
  }

  async findLatestByDeliveryId(
    deliveryId: string,
  ): Promise<DriverAssignmentDto | null> {
    return (
      this.assignments
        .filter((item) => item.deliveryId === deliveryId)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null
    );
  }

  async upsertAssignment(
    input: {
      deliveryId: string;
      providerBookingId: string;
      providerId: string;
      providerDriverId: string | null;
      driverName: string | null;
      driverPhoneCountryCode: string | null;
      driverPhoneNumber: string | null;
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
    _client?: Prisma.TransactionClient,
  ): Promise<DriverAssignmentDto> {
    const existing = this.assignments.find(
      (item) => item.deliveryId === input.deliveryId && item.status === "ASSIGNED",
    );
    const now = new Date();
    if (existing) {
      Object.assign(existing, input, { updatedAt: now });
      return existing;
    }
    const row: DriverAssignmentDto = {
      id: randomUUID(),
      ...input,
      metadata: input.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.assignments.push(row);
    return row;
  }
}
