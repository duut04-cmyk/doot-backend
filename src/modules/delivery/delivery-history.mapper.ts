import type { UserRole } from "@prisma/client";
import type { DeliveryCancellationDto } from "../cancellation/cancellation.repository.js";
import { toAdminDriverResponse } from "../driver/driver.mapper.js";
import type { DriverAssignmentDto } from "../driver/driver.types.js";
import type { DeliveryFeedbackDto } from "../feedback/feedback.types.js";
import type { DeliveryOtpDto } from "../otp/otp.repository.js";
import type { OrchestrationRequestDto } from "../orchestration/orchestration.types.js";
import { toCustomerOrchestrationResult } from "../orchestration/orchestration.mapper.js";
import type { DeliveryRatingDto } from "../rating/rating.types.js";
import type { TrackingPointDto } from "../tracking/tracking.repository.js";
import type { ProviderBookingDto } from "../booking/booking.types.js";
import type { DeliveryWithRelations } from "./delivery.repository.js";
import { toPhoneResponse } from "../../core/phone/phone.js";
import { decimalToNumber } from "./delivery.types.js";
import type { DeliveryHistoryDetail, OtpHistoryMetadata } from "./delivery-history.types.js";
import type { DeliveryStatusEvent } from "@prisma/client";

function mapOtpMetadata(otp: DeliveryOtpDto | null): OtpHistoryMetadata | null {
  if (!otp) {
    return null;
  }

  const now = Date.now();
  let status: OtpHistoryMetadata["status"] = "ACTIVE";
  if (otp.consumedAt) {
    status = "CONSUMED";
  } else if (otp.attempts >= otp.maxAttempts) {
    status = "LOCKED";
  } else if (otp.expiresAt.getTime() <= now) {
    status = "EXPIRED";
  }

  return {
    generatedAt: otp.createdAt.toISOString(),
    expiresAt: otp.expiresAt.toISOString(),
    verifiedAt: otp.consumedAt?.toISOString() ?? null,
    consumedAt: otp.consumedAt?.toISOString() ?? null,
    attempts: otp.attempts,
    maxAttempts: otp.maxAttempts,
    status,
  };
}

function mapBooking(booking: ProviderBookingDto | null) {
  if (!booking) {
    return null;
  }
  return {
    id: booking.id,
    providerCode: booking.providerCode,
    serviceCode: booking.providerServiceCode,
    status: booking.status,
    providerReference: booking.providerReference,
    providerOrderId: booking.providerOrderId,
    quote: {
      amount:
        booking.bookedAmount ??
        booking.quotedAmount ??
        booking.quoteSnapshot.amount,
      currency:
        booking.bookedCurrency ??
        booking.quotedCurrency ??
        booking.quoteSnapshot.currency,
    },
    bookedAt: booking.bookedAt?.toISOString() ?? null,
  };
}

function mapOrchestration(
  deliveryId: string,
  deliveryStatus: string,
  request: OrchestrationRequestDto | null,
) {
  if (!request) {
    return null;
  }
  const result = toCustomerOrchestrationResult(deliveryId, deliveryStatus, request);
  return {
    id: result.orchestration.id,
    attemptNumber: result.orchestration.attemptNumber,
    completedAt: result.orchestration.completedAt,
    selectedOption: result.orchestration.selectedOption
      ? {
          providerCode: result.orchestration.selectedOption.providerCode,
          serviceCode: result.orchestration.selectedOption.serviceCode,
          quote: result.orchestration.selectedOption.quote,
          selectionReason: result.orchestration.selectedOption.selectionReason,
        }
      : null,
  };
}

function mapCancellation(cancellation: DeliveryCancellationDto | null) {
  if (!cancellation) {
    return null;
  }
  return {
    id: cancellation.id,
    status: cancellation.status,
    reasonCode: cancellation.reasonCode,
    reasonMessage: cancellation.reasonMessage,
    requestedAt: cancellation.requestedAt.toISOString(),
    cancelledAt: cancellation.cancelledAt?.toISOString() ?? null,
    providerCancellationReference: cancellation.providerCancellationReference,
  };
}

function mapTracking(latest: TrackingPointDto | null, history: TrackingPointDto[]) {
  return {
    latest: latest
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
    history: history.map((point) => ({
      id: point.id,
      latitude: point.latitude,
      longitude: point.longitude,
      normalizedStatus: point.normalizedStatus,
      providerStatus: point.providerStatus,
      eta: point.eta?.toISOString() ?? null,
      trackingUrl: point.trackingUrl,
      receivedAt: point.receivedAt.toISOString(),
    })),
  };
}

export function toDeliveryHistoryDetail(input: {
  delivery: DeliveryWithRelations;
  role: UserRole;
  timeline: DeliveryStatusEvent[];
  orchestration: OrchestrationRequestDto | null;
  booking: ProviderBookingDto | null;
  driver: DriverAssignmentDto | null;
  latestTracking: TrackingPointDto | null;
  trackingHistory: TrackingPointDto[];
  cancellation: DeliveryCancellationDto | null;
  pickupOtp: DeliveryOtpDto | null;
  deliveryOtp: DeliveryOtpDto | null;
  rating: DeliveryRatingDto | null;
  feedback: DeliveryFeedbackDto | null;
}): DeliveryHistoryDetail {
  const detail = input.delivery;
  const driverResponse = toAdminDriverResponse(input.role, input.driver);

  return {
    delivery: {
      id: detail.id,
      reference: detail.reference,
      status: detail.status,
      specialInstructions: detail.specialInstructions,
      createdAt: detail.createdAt.toISOString(),
      updatedAt: detail.updatedAt.toISOString(),
    },
    pickup: {
      addressText: detail.pickup.addressText,
      contactName: detail.pickup.contactName,
      contactPhone: toPhoneResponse(
        detail.pickup.contactPhoneCountryCode,
        detail.pickup.contactPhoneNumber,
      )!,
      instructions: detail.pickup.instructions,
    },
    drop: {
      addressText: detail.drop.addressText,
      contactName: detail.drop.contactName,
      contactPhone: toPhoneResponse(
        detail.drop.contactPhoneCountryCode,
        detail.drop.contactPhoneNumber,
      )!,
      instructions: detail.drop.instructions,
    },
    package: {
      packageType: detail.package.packageType,
      sizeTier: detail.package.sizeTier,
      description: detail.package.description,
      weightKg: decimalToNumber(detail.package.weightKg),
      lengthCm:
        detail.package.lengthCm == null
          ? null
          : decimalToNumber(detail.package.lengthCm),
      widthCm:
        detail.package.widthCm == null
          ? null
          : decimalToNumber(detail.package.widthCm),
      heightCm:
        detail.package.heightCm == null
          ? null
          : decimalToNumber(detail.package.heightCm),
      quantity: detail.package.quantity,
      requirements: detail.requirements.map((item) => item.requirement),
      photos: detail.package.photos.map((photo) => ({
        objectKey: photo.objectKey,
        storageProvider: photo.storageProvider,
        mimeType: photo.mimeType,
        fileSizeBytes: photo.fileSizeBytes,
      })),
    },
    schedule: {
      mode: detail.schedule.mode,
      timezone: detail.schedule.timezone,
      scheduledAt: detail.schedule.scheduledAt?.toISOString() ?? null,
      windowStart: detail.schedule.windowStart?.toISOString() ?? null,
      windowEnd: detail.schedule.windowEnd?.toISOString() ?? null,
    },
    timeline: input.timeline.map((event) => ({
      id: event.id,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      source: event.source,
      reason: event.reason,
      createdAt: event.createdAt.toISOString(),
    })),
    orchestration: mapOrchestration(
      detail.id,
      detail.status,
      input.orchestration,
    ),
    booking: mapBooking(input.booking),
    driver: driverResponse as Record<string, unknown>,
    tracking: mapTracking(input.latestTracking, input.trackingHistory),
    cancellation: mapCancellation(input.cancellation),
    otp: {
      pickup: mapOtpMetadata(input.pickupOtp),
      delivery: mapOtpMetadata(input.deliveryOtp),
    },
    rating: input.rating
      ? {
          driverRating: input.rating.driverRating,
          deliveryRating: input.rating.deliveryRating,
          submittedAt: input.rating.createdAt.toISOString(),
        }
      : null,
    feedback: input.feedback
      ? {
          positiveTags: input.feedback.positiveTags,
          issueTags: input.feedback.issueTags,
          comment: input.feedback.comment,
          submittedAt: input.feedback.createdAt.toISOString(),
        }
      : null,
  };
}
