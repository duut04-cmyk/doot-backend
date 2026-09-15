import type { DeliveryStatus } from "@prisma/client";
import { getPrismaClient } from "../../config/database.js";
import { logger } from "../../config/logger.js";
import {
  bookingRepository,
  type IBookingRepository,
} from "../booking/booking.repository.js";
import {
  driverService,
  type DriverService,
} from "../driver/driver.service.js";
import { isTerminalDeliveryStatus } from "../delivery/delivery.transitions.js";
import type { NormalizedProviderWebhookEvent } from "../provider/contracts/webhook.js";
import {
  trackingService,
  type TrackingService,
} from "../tracking/tracking.service.js";

export class OperationalWebhookHandler {
  constructor(
    private readonly bookingRepo: IBookingRepository = bookingRepository,
    private readonly driver: DriverService = driverService,
    private readonly tracking: TrackingService = trackingService,
  ) {}

  async handle(input: {
    requestId: string;
    deliveryId: string;
    normalizedEvent: NormalizedProviderWebhookEvent;
  }): Promise<"PROCESSED" | "IGNORED"> {
    const delivery = await getPrismaClient().delivery.findUnique({
      where: { id: input.deliveryId },
      select: { id: true, status: true },
    });
    if (!delivery) {
      return "IGNORED";
    }

    if (isTerminalDeliveryStatus(delivery.status)) {
      logger.info(
        {
          requestId: input.requestId,
          deliveryId: input.deliveryId,
          status: delivery.status,
        },
        "tracking.ignored",
      );
      return "IGNORED";
    }

    const booking = await this.bookingRepo.findLatestBookedByDeliveryId(
      input.deliveryId,
    );
    if (!booking) {
      return "IGNORED";
    }

    if (input.normalizedEvent.driver) {
      await this.driver.upsertFromWebhook({
        deliveryId: input.deliveryId,
        deliveryStatus: delivery.status,
        providerBookingId: booking.id,
        providerId: booking.providerId,
        driver: input.normalizedEvent.driver,
        known: true,
        assigned: input.normalizedEvent.driver.name != null ||
          input.normalizedEvent.driver.providerDriverId != null,
        source: "PROVIDER_WEBHOOK",
        providerStatus: input.normalizedEvent.status,
        metadata: input.normalizedEvent.metadata,
      });
    }

    await this.tracking.ingestFromWebhook({
      deliveryId: input.deliveryId,
      deliveryStatus: delivery.status as DeliveryStatus,
      providerBookingId: booking.id,
      providerId: booking.providerId,
      event: input.normalizedEvent,
    });

    return "PROCESSED";
  }
}

export const operationalWebhookHandler = new OperationalWebhookHandler();
