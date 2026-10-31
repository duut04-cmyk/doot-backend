import { logger } from "../../config/logger.js";
import { getPrismaClient } from "../../config/database.js";
import { SHIPROCKET_PROVIDER_CODE } from "./adapters/shiprocket/shiprocket.constants.js";
import type { ProviderDeliveryLinkResolver } from "./provider.delivery-link.js";
import type {
  ShiprocketTrackingWebhookDeliveryLink,
  ShiprocketTrackingWebhookLinkInput,
} from "./provider.delivery-link.types.js";

type BookingMatch = {
  deliveryId: string;
  bookingId: string;
  providerId: string;
};

export class PrismaProviderDeliveryLinkResolver implements ProviderDeliveryLinkResolver {
  async findDeliveryIdByProviderRefs(input: {
    providerCode: string;
    providerOrderId?: string | null;
    providerDeliveryId?: string | null;
  }): Promise<string | null> {
    try {
      return await this.lookupLegacy(input);
    } catch (error) {
      logger.warn(
        { providerCode: input.providerCode, err: error },
        "provider_delivery_link_lookup_failed",
      );
      return null;
    }
  }

  async resolveShiprocketTrackingWebhook(
    input: ShiprocketTrackingWebhookLinkInput,
  ): Promise<ShiprocketTrackingWebhookDeliveryLink> {
    try {
      const matches = await this.collectShiprocketBookingMatches(input);
      const byDelivery = new Map<string, BookingMatch>();
      for (const match of matches) {
        byDelivery.set(match.deliveryId, match);
      }

      if (byDelivery.size === 0) {
        return { outcome: "not_found" };
      }
      if (byDelivery.size > 1) {
        return {
          outcome: "ambiguous",
          deliveryIds: [...byDelivery.keys()],
        };
      }

      const only = [...byDelivery.values()][0]!;
      return {
        outcome: "matched",
        deliveryId: only.deliveryId,
        bookingId: only.bookingId,
        providerId: only.providerId,
      };
    } catch (error) {
      logger.warn({ err: error }, "shiprocket_webhook_delivery_link_failed");
      return { outcome: "not_found" };
    }
  }

  private async collectShiprocketBookingMatches(
    input: ShiprocketTrackingWebhookLinkInput,
  ): Promise<BookingMatch[]> {
    const db = getPrismaClient();
    const providerCode = SHIPROCKET_PROVIDER_CODE;
    const matches: BookingMatch[] = [];
    const seenBookingIds = new Set<string>();

    const pushMatch = (row: BookingMatch) => {
      if (seenBookingIds.has(row.bookingId)) {
        return;
      }
      seenBookingIds.add(row.bookingId);
      matches.push(row);
    };

    if (input.awb) {
      const byAwb = await db.providerBooking.findMany({
        where: {
          providerCode,
          status: "BOOKED",
          quoteSnapshot: {
            path: ["providerMetadata", "shiprocketAwbCode"],
            equals: input.awb,
          },
        },
        select: { id: true, deliveryId: true, providerId: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      });
      for (const row of byAwb) {
        pushMatch({
          bookingId: row.id,
          deliveryId: row.deliveryId,
          providerId: row.providerId,
        });
      }
    }

    const orderIds = new Set<string>();
    if (input.srOrderId) {
      orderIds.add(input.srOrderId);
    }
    if (input.orderId && input.orderId !== input.srOrderId) {
      orderIds.add(input.orderId);
    }

    for (const providerOrderId of orderIds) {
      const byOrder = await db.providerBooking.findMany({
        where: {
          providerCode,
          status: "BOOKED",
          providerOrderId,
        },
        select: { id: true, deliveryId: true, providerId: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      });
      for (const row of byOrder) {
        pushMatch({
          bookingId: row.id,
          deliveryId: row.deliveryId,
          providerId: row.providerId,
        });
      }
    }

    return matches;
  }

  private async lookupLegacy(input: {
    providerCode: string;
    providerOrderId?: string | null;
    providerDeliveryId?: string | null;
  }): Promise<string | null> {
    const db = getPrismaClient();
    if (input.providerOrderId) {
      const byOrder = await db.providerBooking.findFirst({
        where: {
          providerCode: input.providerCode.toUpperCase(),
          providerOrderId: input.providerOrderId,
          status: "BOOKED",
        },
        orderBy: { createdAt: "desc" },
        select: { deliveryId: true },
      });
      if (byOrder) {
        return byOrder.deliveryId;
      }
    }

    if (input.providerDeliveryId) {
      const byReference = await db.providerBooking.findFirst({
        where: {
          providerCode: input.providerCode.toUpperCase(),
          OR: [
            { providerReference: input.providerDeliveryId },
            { correlationReference: input.providerDeliveryId },
          ],
          status: "BOOKED",
        },
        orderBy: { createdAt: "desc" },
        select: { deliveryId: true },
      });
      if (byReference) {
        return byReference.deliveryId;
      }
    }

    return null;
  }
}

export const prismaProviderDeliveryLinkResolver =
  new PrismaProviderDeliveryLinkResolver();
