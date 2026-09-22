import type { DeliveryStatus, OperationalDataSource, UserRole } from "@prisma/client";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
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
import { requireBookedProviderBooking } from "../operations/operational-context.js";
import type { NormalizedDriver } from "../provider/contracts/common.js";
import type { NormalizedTrackingResult } from "../provider/contracts/tracking.js";
import {
  operationalRefreshService,
  type OperationalRefreshService,
} from "../operations/operational-refresh.service.js";
import type { AdapterExecutionContext } from "../provider/adapters/provider-adapter.types.js";
import {
  bookingRepository,
  type IBookingRepository,
} from "../booking/booking.repository.js";
import { toAdminDriverResponse, toCustomerDriverResponse } from "./driver.mapper.js";
import { driverRepository, type IDriverRepository } from "./driver.repository.js";
import type { UpsertDriverInput } from "./driver.types.js";

function mapDriverFields(driver: NormalizedDriver | null) {
  if (!driver) {
    return {
      providerDriverId: null,
      driverName: null,
      driverPhoneCountryCode: null,
      driverPhoneNumber: null,
      driverPhotoUrl: null,
      providerRating: null,
      vehicleType: null,
      vehicleNumber: null,
      assignedAt: null,
    };
  }
  return {
    providerDriverId: driver.providerDriverId,
    driverName: driver.name,
    driverPhoneCountryCode: driver.phone?.countryCode ?? null,
    driverPhoneNumber: driver.phone?.number ?? null,
    driverPhotoUrl: driver.photoUrl,
    providerRating: driver.providerRating,
    vehicleType: driver.vehicleType,
    vehicleNumber: driver.vehicleNumber,
    assignedAt: driver.assignedAt ? new Date(driver.assignedAt) : null,
  };
}

export class DriverService {
  constructor(
    private readonly deliveryRepo: IDeliveryRepository = deliveryRepository,
    private readonly bookingRepo: IBookingRepository = bookingRepository,
    private readonly driverRepo: IDriverRepository = driverRepository,
    private readonly lifecycle: DeliveryLifecycleService = deliveryLifecycleService,
    private readonly operationalRefresh: OperationalRefreshService = operationalRefreshService,
  ) {}

  async getDriver(input: { deliveryId: string; userId: string; role: UserRole }) {
    await loadAuthorizedDelivery(
      this.deliveryRepo,
      input.deliveryId,
      input.userId,
      input.role,
    );
    const assignment =
      (await this.driverRepo.findActiveByDeliveryId(input.deliveryId)) ??
      (await this.driverRepo.findLatestByDeliveryId(input.deliveryId));
    return {
      success: true as const,
      data: toAdminDriverResponse(input.role, assignment),
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
    const refresh = await this.operationalRefresh.refreshFromProvider({
      deliveryId: input.deliveryId,
      requestId: input.requestId,
      source: "ADMIN_DRIVER_REFRESH",
      failureMode: "preserve",
      testHints: input.testHints,
    });

    if (!refresh.pollSucceeded) {
      const existing = await this.driverRepo.findActiveByDeliveryId(input.deliveryId);
      if (existing) {
        return {
          success: true as const,
          data: toCustomerDriverResponse(existing),
        };
      }
    }

    if (refresh.driverAssignment) {
      return {
        success: true as const,
        data: toCustomerDriverResponse(refresh.driverAssignment),
      };
    }

    const fallback = await this.driverRepo.findActiveByDeliveryId(input.deliveryId);
    return {
      success: true as const,
      data: toCustomerDriverResponse(fallback),
    };
  }

  async ingestFromPoll(input: {
    deliveryId: string;
    deliveryStatus: DeliveryStatus;
    providerBookingId: string;
    providerId: string;
    tracking: NormalizedTrackingResult;
  }) {
    const driver = input.tracking.driver;
    const assigned = driver != null;

    return this.upsertFromProvider({
      deliveryId: input.deliveryId,
      deliveryStatus: input.deliveryStatus,
      providerBookingId: input.providerBookingId,
      providerId: input.providerId,
      driver,
      known: true,
      assigned,
      source: "PROVIDER_POLL",
      providerStatus: input.tracking.status,
    });
  }

  async upsertFromWebhook(
    input: UpsertDriverInput & { deliveryStatus: DeliveryStatus },
  ) {
    return this.upsertFromProvider(input);
  }

  async simulateProviderAssignment(input: {
    deliveryId: string;
    userId: string;
    role: UserRole;
    driver: NormalizedDriver;
  }) {
    const delivery = await loadAuthorizedDelivery(
      this.deliveryRepo,
      input.deliveryId,
      input.userId,
      input.role,
    );
    const booking = await requireBookedProviderBooking(
      input.deliveryId,
      this.bookingRepo,
    );

    if (delivery.status !== "BOOKED" && delivery.status !== "DRIVER_ASSIGNED") {
      throw new AppError(
        "Driver simulation is not allowed for the current delivery status.",
        {
          statusCode: 409,
          code: ErrorCodes.DELIVERY_INVALID_TRANSITION,
        },
      );
    }

    const row = await this.upsertFromProvider({
      deliveryId: input.deliveryId,
      deliveryStatus: delivery.status,
      providerBookingId: booking.id,
      providerId: booking.providerId,
      driver: input.driver,
      known: true,
      assigned: true,
      source: "SYSTEM",
      providerStatus: "ASSIGNED",
      metadata: { simulation: true },
    });

    return {
      success: true as const,
      data: toCustomerDriverResponse(row),
    };
  }

  private async upsertFromProvider(
    input: UpsertDriverInput & { deliveryStatus: DeliveryStatus },
  ) {
    const existingAssigned = await this.driverRepo.findActiveByDeliveryId(
      input.deliveryId,
    );

    if (!input.known) {
      if (existingAssigned) {
        return existingAssigned;
      }
      const row = await this.driverRepo.upsertAssignment({
        deliveryId: input.deliveryId,
        providerBookingId: input.providerBookingId,
        providerId: input.providerId,
        ...mapDriverFields(null),
        status: "UNKNOWN",
        source: input.source,
        providerStatus: input.providerStatus ?? null,
        metadata: input.metadata ?? null,
      });
      return row;
    }

    const incomingFields = mapDriverFields(input.driver);
    const fields =
      existingAssigned && !input.assigned
        ? {
            providerDriverId:
              incomingFields.providerDriverId ?? existingAssigned.providerDriverId,
            driverName: incomingFields.driverName ?? existingAssigned.driverName,
            driverPhoneCountryCode:
              incomingFields.driverPhoneCountryCode ??
              existingAssigned.driverPhoneCountryCode,
            driverPhoneNumber:
              incomingFields.driverPhoneNumber ?? existingAssigned.driverPhoneNumber,
            driverPhotoUrl:
              incomingFields.driverPhotoUrl ?? existingAssigned.driverPhotoUrl,
            providerRating:
              incomingFields.providerRating ?? existingAssigned.providerRating,
            vehicleType: incomingFields.vehicleType ?? existingAssigned.vehicleType,
            vehicleNumber:
              incomingFields.vehicleNumber ?? existingAssigned.vehicleNumber,
            assignedAt: incomingFields.assignedAt ?? existingAssigned.assignedAt,
          }
        : incomingFields;
    const status = input.assigned
      ? "ASSIGNED"
      : existingAssigned
        ? "ASSIGNED"
        : "UNASSIGNED";

    const row = await this.driverRepo.upsertAssignment({
      deliveryId: input.deliveryId,
      providerBookingId: input.providerBookingId,
      providerId: input.providerId,
      ...fields,
      status,
      source: input.source,
      providerStatus: input.providerStatus ?? null,
      metadata: input.metadata ?? null,
    });

    if (
      input.assigned &&
      (input.deliveryStatus === "BOOKED" || input.deliveryStatus === "DRIVER_ASSIGNED")
    ) {
      await this.lifecycle.transition({
        deliveryId: input.deliveryId,
        currentStatus: input.deliveryStatus,
        toStatus: "DRIVER_ASSIGNED",
        expectedFromStatuses: ["BOOKED", "DRIVER_ASSIGNED"],
        source: mapDriverAssignmentLifecycleSource(input.source),
        reason: "Driver assigned by provider",
        metadata: { driverAssignmentId: row.id },
      });
    }

    logger.info(
      {
        deliveryId: input.deliveryId,
        assigned: input.assigned,
        known: input.known,
        source: input.source,
      },
      "driver.assignment.updated",
    );

    return row;
  }
}

function mapDriverAssignmentLifecycleSource(
  source: OperationalDataSource,
): "WEBHOOK" | "TRACKING" | "SYSTEM" {
  if (source === "PROVIDER_WEBHOOK") {
    return "WEBHOOK";
  }
  if (source === "SYSTEM") {
    return "SYSTEM";
  }
  return "TRACKING";
}

export const driverService = new DriverService();
