import type { DeliveryStatus } from "@prisma/client";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import { logger } from "../../config/logger.js";
import {
  deliveryRepository,
  type IDeliveryRepository,
} from "../delivery/delivery.repository.js";
import type { DriverService } from "../driver/driver.service.js";
import {
  bookingRepository,
  type IBookingRepository,
} from "../booking/booking.repository.js";
import {
  ProviderAdapterExecutor,
  providerAdapterExecutor,
} from "../provider/adapters/provider-adapter-executor.js";
import type { AdapterExecutionContext } from "../provider/adapters/provider-adapter.types.js";
import type { TrackingService } from "../tracking/tracking.service.js";
import { requireBookedProviderBooking } from "./operational-context.js";
import type {
  OperationalRefreshFailureMode,
  OperationalRefreshResult,
  OperationalRefreshSource,
} from "./operational-refresh.types.js";

export type OperationalRefreshDeps = {
  driver: DriverService;
  tracking: TrackingService;
};

export class OperationalRefreshService {
  private deps: OperationalRefreshDeps | null = null;

  constructor(
    private readonly deliveryRepo: IDeliveryRepository = deliveryRepository,
    private readonly bookingRepo: IBookingRepository = bookingRepository,
    private readonly adapterExecutor: ProviderAdapterExecutor = providerAdapterExecutor,
    deps?: OperationalRefreshDeps,
  ) {
    if (deps) {
      this.deps = deps;
    }
  }

  configure(deps: OperationalRefreshDeps): void {
    this.deps = deps;
  }

  private requireDeps(): OperationalRefreshDeps {
    if (!this.deps) {
      throw new Error(
        "OperationalRefreshService is not configured with driver and tracking handlers",
      );
    }
    return this.deps;
  }

  async refreshFromProvider(input: {
    deliveryId: string;
    requestId: string;
    source: OperationalRefreshSource;
    failureMode: OperationalRefreshFailureMode;
    testHints?: AdapterExecutionContext["testHints"];
  }): Promise<OperationalRefreshResult> {
    const { driver, tracking } = this.requireDeps();

    const delivery = await this.deliveryRepo.findById(input.deliveryId);
    if (!delivery) {
      throw new AppError("Delivery not found.", {
        statusCode: 404,
        code: ErrorCodes.DELIVERY_NOT_FOUND,
      });
    }

    const booking = await requireBookedProviderBooking(
      input.deliveryId,
      this.bookingRepo,
    );

    let trackingResult;
    try {
      trackingResult = await this.adapterExecutor.execute({
        providerCode: booking.providerCode,
        operation: "getTracking",
        payload: {
          providerBookingId: booking.providerOrderId!,
          deliveryReference: delivery.reference,
        },
        requestId: input.requestId,
        testHints: input.testHints,
      });
    } catch (error) {
      logger.warn(
        {
          requestId: input.requestId,
          deliveryId: input.deliveryId,
          source: input.source,
        },
        "operational_refresh.provider_failed",
      );

      if (input.failureMode === "throw") {
        throw error;
      }

      return {
        pollSucceeded: false,
        deliveryId: input.deliveryId,
        deliveryStatus: delivery.status,
        driverAssignment: null,
        trackingPoint: null,
      };
    }

    const driverAssignment = await driver.ingestFromPoll({
      deliveryId: input.deliveryId,
      deliveryStatus: delivery.status,
      providerBookingId: booking.id,
      providerId: booking.providerId,
      tracking: trackingResult,
    });

    const refreshedDelivery = await this.deliveryRepo.findById(input.deliveryId);
    const deliveryStatus: DeliveryStatus = refreshedDelivery?.status ?? delivery.status;

    const trackingPoint = await tracking.ingestFromPoll({
      deliveryId: input.deliveryId,
      deliveryStatus,
      providerBookingId: booking.id,
      providerId: booking.providerId,
      tracking: trackingResult,
    });

    logger.info(
      {
        requestId: input.requestId,
        deliveryId: input.deliveryId,
        source: input.source,
        deliveryStatus,
      },
      "operational_refresh.completed",
    );

    return {
      pollSucceeded: true,
      deliveryId: input.deliveryId,
      deliveryStatus,
      driverAssignment,
      trackingPoint,
    };
  }
}

export const operationalRefreshService = new OperationalRefreshService();
