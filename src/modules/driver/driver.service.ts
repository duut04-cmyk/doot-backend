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
import { requireBookedProviderBooking } from "../operations/operational-context.js";
import type { NormalizedDriver } from "../provider/contracts/common.js";
import {
  ProviderAdapterExecutor,
  providerAdapterExecutor,
} from "../provider/adapters/provider-adapter-executor.js";
import type { AdapterExecutionContext } from "../provider/adapters/provider-adapter.types.js";
import {
  bookingRepository,
  type IBookingRepository,
} from "../booking/booking.repository.js";
import { toAdminDriverResponse, toCustomerDriverResponse } from "./driver.mapper.js";
import {
  driverRepository,
  type IDriverRepository,
} from "./driver.repository.js";
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
    private readonly adapterExecutor: ProviderAdapterExecutor = providerAdapterExecutor,
  ) {}

  async getDriver(input: {
    deliveryId: string;
    userId: string;
    role: UserRole;
  }) {
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

    let driver: NormalizedDriver | null = null;
    let assigned = false;
    let providerStatus: string | null = null;
    let pollSucceeded = false;

    try {
      const tracking = await this.adapterExecutor.execute({
        providerCode: booking.providerCode,
        operation: "getTracking",
        payload: {
          providerBookingId: booking.providerOrderId!,
          deliveryReference: delivery.reference,
        },
        requestId: input.requestId,
        testHints: input.testHints,
      });
      driver = tracking.driver;
      providerStatus = tracking.status;
      pollSucceeded = true;
      assigned = driver != null;
    } catch {
      // pollSucceeded remains false — preserve any existing assigned snapshot below.
    }

    if (!pollSucceeded) {
      const existing = await this.driverRepo.findActiveByDeliveryId(
        input.deliveryId,
      );
      if (existing) {
        return {
          success: true as const,
          data: toCustomerDriverResponse(existing),
        };
      }
    }

    const result = await this.upsertFromProvider({
      deliveryId: input.deliveryId,
      deliveryStatus: delivery.status,
      providerBookingId: booking.id,
      providerId: booking.providerId,
      driver,
      known: pollSucceeded,
      assigned,
      source: "PROVIDER_POLL",
      providerStatus,
    });

    return {
      success: true as const,
      data: toCustomerDriverResponse(result),
    };
  }

  async upsertFromWebhook(
    input: UpsertDriverInput & { deliveryStatus: DeliveryStatus },
  ) {
    return this.upsertFromProvider(input);
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
              incomingFields.providerDriverId ??
              existingAssigned.providerDriverId,
            driverName: incomingFields.driverName ?? existingAssigned.driverName,
            driverPhoneCountryCode:
              incomingFields.driverPhoneCountryCode ??
              existingAssigned.driverPhoneCountryCode,
            driverPhoneNumber:
              incomingFields.driverPhoneNumber ??
              existingAssigned.driverPhoneNumber,
            driverPhotoUrl:
              incomingFields.driverPhotoUrl ?? existingAssigned.driverPhotoUrl,
            providerRating:
              incomingFields.providerRating ?? existingAssigned.providerRating,
            vehicleType:
              incomingFields.vehicleType ?? existingAssigned.vehicleType,
            vehicleNumber:
              incomingFields.vehicleNumber ?? existingAssigned.vehicleNumber,
            assignedAt:
              incomingFields.assignedAt ?? existingAssigned.assignedAt,
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
        source: input.source === "PROVIDER_WEBHOOK" ? "WEBHOOK" : "TRACKING",
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

export const driverService = new DriverService();
