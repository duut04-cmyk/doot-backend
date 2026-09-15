import { logger } from "../../config/logger.js";
import { getPrismaClient } from "../../config/database.js";
import type { ProviderDeliveryLinkResolver } from "./provider.delivery-link.js";

export class PrismaProviderDeliveryLinkResolver
  implements ProviderDeliveryLinkResolver
{
  async findDeliveryIdByProviderRefs(input: {
    providerCode: string;
    providerOrderId?: string | null;
    providerDeliveryId?: string | null;
  }): Promise<string | null> {
    try {
      return await this.lookup(input);
    } catch (error) {
      logger.warn(
        { providerCode: input.providerCode, err: error },
        "provider_delivery_link_lookup_failed",
      );
      return null;
    }
  }

  private async lookup(input: {
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
