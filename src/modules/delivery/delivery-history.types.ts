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
      url?: string | null;
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
    refund: DeliveryHistoryCancellationRefund | null;
  } | null;
  payment: DeliveryHistoryPayment | null;
  otp: {
    pickup: OtpHistoryMetadata | null;
    delivery: OtpHistoryMetadata | null;
  };
  rating: {
    driverRating: number;
    platformRating: number | null;
    deliveryRating: number;
    timelinessRating: number | null;
    packageHandlingRating: number | null;
    servicePresentationRating: number | null;
    submittedAt: string;
  } | null;
  feedback: {
    positiveTags: FeedbackPositiveTag[];
    issueTags: FeedbackIssueTag[];
    comment: string | null;
    submittedAt: string;
  } | null;
};

export type DeliveryHistoryPricingBreakdown = {
  providerQuoteAmount: number;
  platformFeePercent: number;
  platformFeeAmount: number;
  subtotal: number;
  gstPercent: number;
  gstAmount: number;
  customerPayableAmount: number;
  currency: string;
};

export type DeliveryHistoryPaymentAttempt = {
  id: string;
  attemptNumber: number;
  status: string;
  amount: number;
  currency: string;
  gatewayPaymentId: string | null;
  gatewayOrderId: string | null;
  paymentMethod: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type DeliveryHistoryPaymentRefund = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  reasonCode: string | null;
  reason: string | null;
  gatewayRefundId: string | null;
  gatewayRefundReference: string | null;
  idempotencyKey: string;
  requestedAt: string;
  processedAt: string | null;
};

export type DeliveryHistoryPayment = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  gateway: string;
  gatewayOrderId: string | null;
  gatewayPaymentSessionId: string | null;
  gatewayPaymentId: string | null;
  paidAt: string | null;
  failedAt: string | null;
  expiredAt: string | null;
  refundedAmount: number;
  pricingBreakdown: DeliveryHistoryPricingBreakdown;
  attempts: DeliveryHistoryPaymentAttempt[];
  refunds: DeliveryHistoryPaymentRefund[];
};

export type DeliveryHistoryCancellationRefund = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  gatewayRefundId: string | null;
  gatewayRefundReference: string | null;
  requestedAt: string;
  processedAt: string | null;
  /** Prepaid cancellations refund remaining balance; no platform retention fee. */
  policy: "FULL_REMAINING_PREPAID";
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
