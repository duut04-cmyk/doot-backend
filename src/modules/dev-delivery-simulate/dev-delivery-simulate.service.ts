import type { DeliveryStatus, UserRole } from "@prisma/client";
import { OTP_EXPIRY_SECONDS, OTP_MAX_ATTEMPTS } from "../../config/env.js";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import { hashOtp } from "../auth/auth.crypto.js";
import {
  bookingRepository,
  type IBookingRepository,
} from "../booking/booking.repository.js";
import { loadAuthorizedDelivery } from "../delivery/delivery-access.js";
import {
  deliveryRepository,
  type IDeliveryRepository,
} from "../delivery/delivery.repository.js";
import {
  deliveryLifecycleService,
  type DeliveryLifecycleService,
} from "../delivery/delivery-lifecycle.service.js";
import { decimalToNumber } from "../delivery/delivery.types.js";
import { isTerminalDeliveryStatus } from "../delivery/delivery.transitions.js";
import { driverService, type DriverService } from "../driver/driver.service.js";
import { requireBookedProviderBooking } from "../operations/operational-context.js";
import { otpRepository, type IOtpRepository } from "../otp/otp.repository.js";
import { trackingService, type TrackingService } from "../tracking/tracking.service.js";
import {
  DEV_MOCK_DRIVER,
  DEV_SIMULATE_OTP,
  DEV_SIMULATE_STEPS,
  type DevSimulateStep,
} from "./dev-delivery-simulate.constants.js";
import { isDevDeliverySimulateEnabled } from "./dev-delivery-simulate.config.js";

function stepForStatus(status: DeliveryStatus): DevSimulateStep | null {
  switch (status) {
    case "BOOKED":
      return "ASSIGN_DRIVER";
    case "DRIVER_ASSIGNED":
      return "ISSUE_PICKUP_OTP";
    case "PICKUP_OTP_PENDING":
      return "CONFIRM_PICKUP";
    case "PICKED_UP":
      return "START_TRANSIT";
    case "IN_TRANSIT":
      return "ISSUE_DELIVERY_OTP";
    case "DELIVERY_OTP_PENDING":
      return "CONFIRM_DELIVERY";
    default:
      return null;
  }
}

function nextStepAfter(step: DevSimulateStep): DevSimulateStep | null {
  const index = DEV_SIMULATE_STEPS.indexOf(step);
  if (index < 0 || index >= DEV_SIMULATE_STEPS.length - 1) {
    return null;
  }
  return DEV_SIMULATE_STEPS[index + 1] ?? null;
}

function resolveCoords(input: {
  pickupLat: number | null;
  pickupLng: number | null;
  dropLat: number | null;
  dropLng: number | null;
}): {
  pickup: { latitude: number; longitude: number };
  drop: { latitude: number; longitude: number };
  mid: { latitude: number; longitude: number };
} {
  const pickupLat = input.pickupLat ?? 12.9716;
  const pickupLng = input.pickupLng ?? 77.5946;
  const dropLat = input.dropLat ?? 12.9352;
  const dropLng = input.dropLng ?? 77.6245;
  return {
    pickup: { latitude: pickupLat, longitude: pickupLng },
    drop: { latitude: dropLat, longitude: dropLng },
    mid: {
      latitude: (pickupLat + dropLat) / 2,
      longitude: (pickupLng + dropLng) / 2,
    },
  };
}

export class DevDeliverySimulateService {
  constructor(
    private readonly deliveryRepo: IDeliveryRepository = deliveryRepository,
    private readonly bookingRepo: IBookingRepository = bookingRepository,
    private readonly lifecycle: DeliveryLifecycleService = deliveryLifecycleService,
    private readonly driver: DriverService = driverService,
    private readonly otpRepo: IOtpRepository = otpRepository,
    private readonly tracking: TrackingService = trackingService,
  ) {}

  async advance(input: {
    deliveryId: string;
    userId: string;
    role: UserRole;
    requestId: string;
  }) {
    if (!isDevDeliverySimulateEnabled()) {
      throw new AppError("Delivery simulation is disabled.", {
        statusCode: 403,
        code: ErrorCodes.FORBIDDEN,
      });
    }

    const delivery = await loadAuthorizedDelivery(
      this.deliveryRepo,
      input.deliveryId,
      input.userId,
      input.role,
    );

    if (isTerminalDeliveryStatus(delivery.status)) {
      throw new AppError("Delivery is already in a terminal state.", {
        statusCode: 409,
        code: ErrorCodes.DELIVERY_INVALID_TRANSITION,
      });
    }

    const booking = await requireBookedProviderBooking(
      input.deliveryId,
      this.bookingRepo,
    );
    if (booking.providerCode !== "MOCK") {
      throw new AppError("Simulation is only available for MOCK provider bookings.", {
        statusCode: 403,
        code: ErrorCodes.FORBIDDEN,
      });
    }

    const step = stepForStatus(delivery.status);
    if (!step) {
      throw new AppError(
        "Delivery simulation is not available for the current delivery status.",
        {
          statusCode: 409,
          code: ErrorCodes.DELIVERY_INVALID_TRANSITION,
        },
      );
    }

    const previousStatus = delivery.status;
    const toCoord = (
      value: Parameters<typeof decimalToNumber>[0] | null | undefined,
    ): number | null => (value == null ? null : decimalToNumber(value));

    const coords = resolveCoords({
      pickupLat: toCoord(delivery.pickup.latitude),
      pickupLng: toCoord(delivery.pickup.longitude),
      dropLat: toCoord(delivery.drop.latitude),
      dropLng: toCoord(delivery.drop.longitude),
    });

    let devOtp: string | undefined;

    switch (step) {
      case "ASSIGN_DRIVER":
        await this.driver.simulateProviderAssignment({
          deliveryId: input.deliveryId,
          userId: input.userId,
          role: input.role,
          driver: DEV_MOCK_DRIVER,
        });
        await this.tracking.ingestFromPoll({
          deliveryId: input.deliveryId,
          deliveryStatus: "DRIVER_ASSIGNED",
          providerBookingId: booking.id,
          providerId: booking.providerId,
          tracking: {
            status: "ASSIGNED",
            latitude: coords.pickup.latitude,
            longitude: coords.pickup.longitude,
            accuracyMeters: null,
            providerTimestamp: new Date().toISOString(),
            receivedAt: new Date().toISOString(),
            eta: null,
            trackingUrl: null,
            driver: DEV_MOCK_DRIVER,
            providerEventId: `dev-sim-${input.deliveryId}-assigned`,
          },
        });
        break;

      case "ISSUE_PICKUP_OTP":
        await this.otpRepo.invalidateActive(input.deliveryId, "PICKUP");
        await this.otpRepo.create({
          deliveryId: input.deliveryId,
          type: "PICKUP",
          codeHash: await hashOtp(DEV_SIMULATE_OTP),
          expiresAt: new Date(Date.now() + OTP_EXPIRY_SECONDS * 1000),
          maxAttempts: OTP_MAX_ATTEMPTS,
        });
        await this.lifecycle.transition({
          deliveryId: input.deliveryId,
          currentStatus: delivery.status,
          toStatus: "PICKUP_OTP_PENDING",
          expectedFromStatuses: ["DRIVER_ASSIGNED", "BOOKED"],
          source: "SYSTEM",
          reason: "Dev delivery simulation: pickup OTP issued",
        });
        devOtp = DEV_SIMULATE_OTP;
        break;

      case "CONFIRM_PICKUP":
        await this.consumeActiveOtp(input.deliveryId, "PICKUP");
        await this.lifecycle.transition({
          deliveryId: input.deliveryId,
          currentStatus: delivery.status,
          toStatus: "PICKED_UP",
          expectedFromStatuses: ["PICKUP_OTP_PENDING"],
          source: "OTP",
          reason: "Dev delivery simulation: pickup confirmed",
        });
        await this.tracking.ingestFromPoll({
          deliveryId: input.deliveryId,
          deliveryStatus: "PICKED_UP",
          providerBookingId: booking.id,
          providerId: booking.providerId,
          tracking: {
            status: "PICKED_UP",
            latitude: coords.pickup.latitude,
            longitude: coords.pickup.longitude,
            accuracyMeters: null,
            providerTimestamp: new Date().toISOString(),
            receivedAt: new Date().toISOString(),
            eta: null,
            trackingUrl: null,
            driver: DEV_MOCK_DRIVER,
            providerEventId: `dev-sim-${input.deliveryId}-picked-up`,
          },
        });
        break;

      case "START_TRANSIT":
        await this.lifecycle.transition({
          deliveryId: input.deliveryId,
          currentStatus: delivery.status,
          toStatus: "IN_TRANSIT",
          expectedFromStatuses: ["PICKED_UP"],
          source: "TRACKING",
          reason: "Dev delivery simulation: in transit",
        });
        await this.tracking.ingestFromPoll({
          deliveryId: input.deliveryId,
          deliveryStatus: "IN_TRANSIT",
          providerBookingId: booking.id,
          providerId: booking.providerId,
          tracking: {
            status: "IN_TRANSIT",
            latitude: coords.mid.latitude,
            longitude: coords.mid.longitude,
            accuracyMeters: null,
            providerTimestamp: new Date().toISOString(),
            receivedAt: new Date().toISOString(),
            eta: null,
            trackingUrl: null,
            driver: DEV_MOCK_DRIVER,
            providerEventId: `dev-sim-${input.deliveryId}-in-transit`,
          },
        });
        break;

      case "ISSUE_DELIVERY_OTP":
        await this.otpRepo.invalidateActive(input.deliveryId, "DELIVERY");
        await this.otpRepo.create({
          deliveryId: input.deliveryId,
          type: "DELIVERY",
          codeHash: await hashOtp(DEV_SIMULATE_OTP),
          expiresAt: new Date(Date.now() + OTP_EXPIRY_SECONDS * 1000),
          maxAttempts: OTP_MAX_ATTEMPTS,
        });
        if (delivery.status === "IN_TRANSIT") {
          await this.lifecycle.transition({
            deliveryId: input.deliveryId,
            currentStatus: delivery.status,
            toStatus: "DELIVERY_OTP_PENDING",
            expectedFromStatuses: ["IN_TRANSIT"],
            source: "OTP",
            reason: "Dev delivery simulation: delivery OTP issued",
          });
        }
        devOtp = DEV_SIMULATE_OTP;
        break;

      case "CONFIRM_DELIVERY":
        await this.consumeActiveOtp(input.deliveryId, "DELIVERY");
        await this.lifecycle.transition({
          deliveryId: input.deliveryId,
          currentStatus: delivery.status,
          toStatus: "DELIVERED",
          expectedFromStatuses: ["DELIVERY_OTP_PENDING"],
          source: "OTP",
          reason: "Dev delivery simulation: delivery confirmed",
        });
        await this.tracking.ingestFromPoll({
          deliveryId: input.deliveryId,
          deliveryStatus: "DELIVERED",
          providerBookingId: booking.id,
          providerId: booking.providerId,
          tracking: {
            status: "DELIVERED",
            latitude: coords.drop.latitude,
            longitude: coords.drop.longitude,
            accuracyMeters: null,
            providerTimestamp: new Date().toISOString(),
            receivedAt: new Date().toISOString(),
            eta: null,
            trackingUrl: null,
            driver: DEV_MOCK_DRIVER,
            providerEventId: `dev-sim-${input.deliveryId}-delivered`,
          },
        });
        break;
      default: {
        const _exhaustive: never = step;
        throw new AppError(`Unhandled simulation step: ${_exhaustive}`, {
          statusCode: 500,
          code: ErrorCodes.INTERNAL_ERROR,
        });
      }
    }

    const updated = await this.deliveryRepo.findById(input.deliveryId);
    const status = updated?.status ?? delivery.status;

    return {
      success: true as const,
      data: {
        deliveryId: input.deliveryId,
        previousStatus,
        status,
        step,
        nextStep: nextStepAfter(step),
        ...(devOtp ? { devOtp } : {}),
      },
    };
  }

  private async consumeActiveOtp(
    deliveryId: string,
    type: "PICKUP" | "DELIVERY",
  ): Promise<void> {
    const active = await this.otpRepo.findActive(deliveryId, type);
    if (active) {
      await this.otpRepo.consume(active.id);
    }
  }
}

export const devDeliverySimulateService = new DevDeliverySimulateService();
