import type { FeedbackIssueTag, FeedbackPositiveTag } from "@prisma/client";
import type { PhoneResponse } from "../../core/phone/phone.types.js";

export type DeliveryHistoryDetail = {
  delivery: {
    id: string;
    reference: string;
    status: string;
    specialInstructions: string | null;
    createdAt: string;
    updatedAt: string;
  };
  pickup: {
    addressText: string;
    contactName: string;
    contactPhone: PhoneResponse;
    instructions: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  drop: {
    addressText: string;
    contactName: string;
    contactPhone: PhoneResponse;
    instructions: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  package: {
    packageType: string;
    sizeTier: string;
    description: string | null;
    weightKg: number;
    lengthCm: number | null;
    widthCm: number | null;
    heightCm: number | null;
    quantity: number;
    requirements: string[];
    photos: Array<{
      objectKey: string;
      storageProvider: string;
      mimeType: string | null;
      fileSizeBytes: number | null;
    }>;
  };
  schedule: {
    mode: string;
    timezone: string;
    scheduledAt: string | null;
    windowStart: string | null;
    windowEnd: string | null;
  };
  timeline: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    source: string;
    reason: string | null;
    createdAt: string;
  }>;
  orchestration: {
    id: string;
    attemptNumber: number;
    completedAt: string | null;
    selectedOption: {
      providerCode: string;
      serviceCode: string | null;
      quote: { amount: number; currency: string };
      selectionReason: string | null;
    } | null;
  } | null;
  booking: {
    id: string;
    providerCode: string;
    serviceCode: string | null;
    status: string;
    providerReference: string | null;
    providerOrderId: string | null;
    quote: { amount: number; currency: string };
    bookedAt: string | null;
  } | null;
  driver: Record<string, unknown>;
  tracking: {
    latest: {
      normalizedStatus: string | null;
      providerStatus: string | null;
      latitude: number | null;
      longitude: number | null;
      eta: string | null;
      trackingUrl: string | null;
      lastUpdatedAt: string;
    } | null;
    history: Array<{
      id: string;
      latitude: number | null;
      longitude: number | null;
      normalizedStatus: string | null;
      providerStatus: string | null;
      eta: string | null;
      trackingUrl: string | null;
      receivedAt: string;
    }>;
  };
  cancellation: {
    id: string;
    status: string;
    reasonCode: string;
    reasonMessage: string | null;
    requestedAt: string;
    cancelledAt: string | null;
    providerCancellationReference: string | null;
  } | null;
  otp: {
    pickup: OtpHistoryMetadata | null;
    delivery: OtpHistoryMetadata | null;
  };
  rating: {
    driverRating: number;
    deliveryRating: number;
    submittedAt: string;
  } | null;
  feedback: {
    positiveTags: FeedbackPositiveTag[];
    issueTags: FeedbackIssueTag[];
    comment: string | null;
    submittedAt: string;
  } | null;
};

export type OtpHistoryMetadata = {
  generatedAt: string;
  expiresAt: string;
  verifiedAt: string | null;
  consumedAt: string | null;
  attempts: number;
  maxAttempts: number;
  status: "ACTIVE" | "CONSUMED" | "EXPIRED" | "LOCKED";
};

export type GetDeliveryHistoryResult = {
  success: true;
  data: DeliveryHistoryDetail;
};
