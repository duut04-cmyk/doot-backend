import type { DeliveryStatus } from "@prisma/client";
import { getPrismaClient } from "../../config/database.js";

export const OPERATIONAL_POLLING_DELIVERY_STATUSES: DeliveryStatus[] = [
  "BOOKED",
  "DRIVER_ASSIGNED",
  "PICKUP_OTP_PENDING",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERY_OTP_PENDING",
];

export type OperationalPollingCandidate = {
  deliveryId: string;
  deliveryStatus: DeliveryStatus;
  deliveryReference: string;
  providerBookingId: string;
  providerId: string;
  providerCode: string;
  providerOrderId: string;
};

export interface IOperationalPollingRepository {
  findEligibleDeliveries(limit: number): Promise<OperationalPollingCandidate[]>;
}

export class PrismaOperationalPollingRepository implements IOperationalPollingRepository {
  async findEligibleDeliveries(limit: number): Promise<OperationalPollingCandidate[]> {
    const rows = await getPrismaClient().delivery.findMany({
      where: {
        status: { in: OPERATIONAL_POLLING_DELIVERY_STATUSES },
        providerBookings: {
          some: {
            status: "BOOKED",
            providerOrderId: { not: null },
          },
        },
      },
      select: {
        id: true,
        status: true,
        reference: true,
        providerBookings: {
          where: {
            status: "BOOKED",
            providerOrderId: { not: null },
          },
          orderBy: { attemptNumber: "desc" },
          take: 1,
          select: {
            id: true,
            providerId: true,
            providerCode: true,
            providerOrderId: true,
          },
        },
      },
      orderBy: { updatedAt: "asc" },
      take: limit,
    });

    const candidates: OperationalPollingCandidate[] = [];
    for (const row of rows) {
      const booking = row.providerBookings[0];
      if (!booking?.providerOrderId) {
        continue;
      }
      candidates.push({
        deliveryId: row.id,
        deliveryStatus: row.status,
        deliveryReference: row.reference,
        providerBookingId: booking.id,
        providerId: booking.providerId,
        providerCode: booking.providerCode,
        providerOrderId: booking.providerOrderId,
      });
    }
    return candidates;
  }
}

export const operationalPollingRepository = new PrismaOperationalPollingRepository();
