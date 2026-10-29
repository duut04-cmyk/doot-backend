import type { ProviderDeliveryLinkResolver } from "../../src/modules/provider/provider.delivery-link.js";
import type {
  ShiprocketTrackingWebhookDeliveryLink,
  ShiprocketTrackingWebhookLinkInput,
} from "../../src/modules/provider/provider.delivery-link.types.js";
import type { InMemoryBookingRepository } from "./in-memory-booking-repository.js";

export class TestShiprocketDeliveryLinkResolver implements ProviderDeliveryLinkResolver {
  constructor(private readonly bookingRepo: InMemoryBookingRepository) {}

  async findDeliveryIdByProviderRefs(): Promise<string | null> {
    return null;
  }

  async resolveShiprocketTrackingWebhook(
    input: ShiprocketTrackingWebhookLinkInput,
  ): Promise<ShiprocketTrackingWebhookDeliveryLink> {
    const matches: Array<{
      deliveryId: string;
      bookingId: string;
      providerId: string;
    }> = [];

    for (const booking of this.bookingRepo.bookings.values()) {
      if (booking.providerCode !== "SHIPROCKET" || booking.status !== "BOOKED") {
        continue;
      }

      const metadata = booking.quoteSnapshot?.providerMetadata as
        Record<string, unknown> | undefined;
      const awb =
        typeof metadata?.shiprocketAwbCode === "string"
          ? metadata.shiprocketAwbCode
          : null;

      if (input.awb && awb === input.awb) {
        matches.push({
          deliveryId: booking.deliveryId,
          bookingId: booking.id,
          providerId: booking.providerId,
        });
      }

      if (input.srOrderId && booking.providerOrderId === input.srOrderId) {
        matches.push({
          deliveryId: booking.deliveryId,
          bookingId: booking.id,
          providerId: booking.providerId,
        });
      }

      if (
        input.orderId &&
        input.orderId !== input.srOrderId &&
        booking.providerOrderId === input.orderId
      ) {
        matches.push({
          deliveryId: booking.deliveryId,
          bookingId: booking.id,
          providerId: booking.providerId,
        });
      }
    }

    const byDelivery = new Map<string, (typeof matches)[number]>();
    for (const match of matches) {
      byDelivery.set(match.deliveryId, match);
    }

    if (byDelivery.size === 0) {
      return { outcome: "not_found" };
    }
    if (byDelivery.size > 1) {
      return { outcome: "ambiguous", deliveryIds: [...byDelivery.keys()] };
    }

    const only = [...byDelivery.values()][0]!;
    return {
      outcome: "matched",
      deliveryId: only.deliveryId,
      bookingId: only.bookingId,
      providerId: only.providerId,
    };
  }
}
