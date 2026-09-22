import type { DeliveryStatus, UserRole } from "@prisma/client";
import { logger } from "../../config/logger.js";
import { loadAuthorizedDelivery } from "../delivery/delivery-access.js";
import {
  deliveryRepository,
  type IDeliveryRepository,
} from "../delivery/delivery.repository.js";
import {
  deliveryLifecycleService,
  type DeliveryLifecycleService,
} from "../delivery/delivery-lifecycle.service.js";
import type { NormalizedTrackingResult } from "../provider/contracts/tracking.js";
import type { NormalizedProviderWebhookEvent } from "../provider/contracts/webhook.js";
import {
  operationalRefreshService,
  type OperationalRefreshService,
} from "../operations/operational-refresh.service.js";
import type { AdapterExecutionContext } from "../provider/adapters/provider-adapter.types.js";
import {
  normalizeProviderTrackingStatus,
  validateCoordinates,
} from "./tracking.normalization.js";
import { trackingRepository, type ITrackingRepository } from "./tracking.repository.js";

const TRACKING_STATUS_TO_DELIVERY: Partial<Record<string, DeliveryStatus>> = {
  PICKED_UP: "PICKED_UP",
  IN_TRANSIT: "IN_TRANSIT",
};

export class TrackingService {
  constructor(
    private readonly deliveryRepo: IDeliveryRepository = deliveryRepository,
    private readonly trackingRepo: ITrackingRepository = trackingRepository,
    private readonly lifecycle: DeliveryLifecycleService = deliveryLifecycleService,
    private readonly operationalRefresh: OperationalRefreshService = operationalRefreshService,
  ) {}

  async getTracking(input: { deliveryId: string; userId: string; role: UserRole }) {
    const delivery = await loadAuthorizedDelivery(
      this.deliveryRepo,
      input.deliveryId,
      input.userId,
      input.role,
    );
    const latest = await this.trackingRepo.findLatestByDeliveryId(input.deliveryId);

    return {
      success: true as const,
      data: {
        deliveryId: input.deliveryId,
        status: delivery.status,
        tracking: latest
          ? {
              normalizedStatus: latest.normalizedStatus,
              providerStatus: latest.providerStatus,
              latitude: latest.latitude,
              longitude: latest.longitude,
              eta: latest.eta?.toISOString() ?? null,
              trackingUrl: latest.trackingUrl,
              lastUpdatedAt: latest.receivedAt.toISOString(),
            }
          : null,
      },
    };
  }

  async getHistory(input: {
    deliveryId: string;
    userId: string;
    role: UserRole;
    page: number;
    limit: number;
  }) {
    await loadAuthorizedDelivery(
      this.deliveryRepo,
      input.deliveryId,
      input.userId,
      input.role,
    );
    const result = await this.trackingRepo.listByDeliveryId(
      input.deliveryId,
      input.page,
      input.limit,
    );
    return {
      success: true as const,
      data: {
        items: result.items.map((point) => ({
          id: point.id,
          normalizedStatus: point.normalizedStatus,
          providerStatus: point.providerStatus,
          latitude: point.latitude,
          longitude: point.longitude,
          eta: point.eta?.toISOString() ?? null,
          trackingUrl: point.trackingUrl,
          receivedAt: point.receivedAt.toISOString(),
        })),
        page: input.page,
        limit: input.limit,
        total: result.total,
      },
    };
  }

  async refreshFromProvider(input: {
    deliveryId: string;
    userId: string;
    role: UserRole;
    requestId: string;
    testHints?: AdapterExecutionContext["testHints"];
  }) {
    await loadAuthorizedDelivery(
      this.deliveryRepo,
      input.deliveryId,
      input.userId,
      input.role,
    );

    await this.operationalRefresh.refreshFromProvider({
      deliveryId: input.deliveryId,
      requestId: input.requestId,
      source: "ADMIN_TRACKING_REFRESH",
      failureMode: "throw",
      testHints: input.testHints,
    });

    return this.getTracking(input);
  }

  async ingestFromPoll(input: {
    deliveryId: string;
    deliveryStatus: DeliveryStatus;
    providerBookingId: string;
    providerId: string;
    tracking: NormalizedTrackingResult;
  }) {
    return this.ingestTrackingResult({
      deliveryId: input.deliveryId,
      deliveryStatus: input.deliveryStatus,
      providerBookingId: input.providerBookingId,
      providerId: input.providerId,
      tracking: input.tracking,
      source: "PROVIDER_POLL",
    });
  }

  async ingestFromWebhook(input: {
    deliveryId: string;
    deliveryStatus: DeliveryStatus;
    providerBookingId: string;
    providerId: string;
    event: NormalizedProviderWebhookEvent;
  }) {
    if (input.event.tracking) {
      const tracking: NormalizedTrackingResult = {
        status: input.event.tracking.status ?? input.event.status ?? "UNKNOWN",
        latitude: input.event.tracking.latitude ?? null,
        longitude: input.event.tracking.longitude ?? null,
        accuracyMeters: null,
        providerTimestamp: input.event.eventTimestamp,
        receivedAt: input.event.receivedAt,
        eta: input.event.tracking.eta ?? null,
        trackingUrl: input.event.tracking.trackingUrl ?? null,
        driver: input.event.driver,
        providerEventId: input.event.providerEventId,
      };
      return this.ingestTrackingResult({
        deliveryId: input.deliveryId,
        deliveryStatus: input.deliveryStatus,
        providerBookingId: input.providerBookingId,
        providerId: input.providerId,
        tracking,
        source: "PROVIDER_WEBHOOK",
      });
    }

    if (input.event.status) {
      const tracking: NormalizedTrackingResult = {
        status: input.event.status,
        latitude: null,
        longitude: null,
        accuracyMeters: null,
        providerTimestamp: input.event.eventTimestamp,
        receivedAt: input.event.receivedAt,
        eta: null,
        trackingUrl: null,
        driver: input.event.driver,
        providerEventId: input.event.providerEventId,
      };
      return this.ingestTrackingResult({
        deliveryId: input.deliveryId,
        deliveryStatus: input.deliveryStatus,
        providerBookingId: input.providerBookingId,
        providerId: input.providerId,
        tracking,
        source: "PROVIDER_WEBHOOK",
      });
    }

    return null;
  }

  private async ingestTrackingResult(input: {
    deliveryId: string;
    deliveryStatus: DeliveryStatus;
    providerBookingId: string;
    providerId: string;
    tracking: NormalizedTrackingResult;
    source: "PROVIDER_POLL" | "PROVIDER_WEBHOOK";
  }) {
    if (
      input.tracking.providerEventId &&
      (await this.trackingRepo.findByProviderEvent(
        input.providerId,
        input.tracking.providerEventId,
      ))
    ) {
      logger.info(
        {
          deliveryId: input.deliveryId,
          providerEventId: input.tracking.providerEventId,
        },
        "tracking.ignored",
      );
      return null;
    }

    const coordsValid = validateCoordinates({
      latitude: input.tracking.latitude,
      longitude: input.tracking.longitude,
    });
    const normalizedStatus = normalizeProviderTrackingStatus(input.tracking.status);

    const point = await this.trackingRepo.createPoint({
      deliveryId: input.deliveryId,
      providerBookingId: input.providerBookingId,
      providerId: input.providerId,
      providerEventId: input.tracking.providerEventId,
      latitude: coordsValid ? input.tracking.latitude : null,
      longitude: coordsValid ? input.tracking.longitude : null,
      accuracyMeters: input.tracking.accuracyMeters,
      providerTimestamp: input.tracking.providerTimestamp
        ? new Date(input.tracking.providerTimestamp)
        : null,
      receivedAt: new Date(input.tracking.receivedAt),
      eta: input.tracking.eta ? new Date(input.tracking.eta) : null,
      providerStatus: input.tracking.status,
      normalizedStatus,
      trackingUrl: input.tracking.trackingUrl,
      source: input.source,
    });

    await this.maybeTransitionFromTracking({
      deliveryId: input.deliveryId,
      currentStatus: input.deliveryStatus,
      normalizedStatus,
    });

    logger.info({ deliveryId: input.deliveryId, normalizedStatus }, "tracking.updated");

    return point;
  }

  private async maybeTransitionFromTracking(input: {
    deliveryId: string;
    currentStatus: DeliveryStatus;
    normalizedStatus: string;
  }) {
    const target = TRACKING_STATUS_TO_DELIVERY[input.normalizedStatus];
    if (!target) {
      return;
    }

    if (input.normalizedStatus === "DELIVERED") {
      return;
    }

    // Pickup completion is authoritative via OTP verification only — never via tracking.
    if (input.normalizedStatus === "PICKED_UP") {
      return;
    }

    // Delivery completion is authoritative via delivery OTP verification only.
    if (
      input.currentStatus === "DELIVERY_OTP_PENDING" ||
      input.currentStatus === "PICKUP_OTP_PENDING"
    ) {
      return;
    }

    const fromMap: Partial<Record<DeliveryStatus, DeliveryStatus[]>> = {
      IN_TRANSIT: ["PICKED_UP"],
    };

    await this.lifecycle.transition({
      deliveryId: input.deliveryId,
      currentStatus: input.currentStatus,
      toStatus: target,
      expectedFromStatuses: fromMap[target] ?? [input.currentStatus],
      source: "TRACKING",
      reason: `Tracking status ${input.normalizedStatus}`,
      allowStaleGuard: true,
    });
  }
}

export const trackingService = new TrackingService();
