import type { ProviderCapability } from "@prisma/client";
import type { NormalizedDriver } from "../../contracts/common.js";
import type { AvailabilityRequest } from "../../contracts/availability.js";
import type { BookingRequest, NormalizedBookingResult } from "../../contracts/booking.js";
import type {
  CancellationRequest,
  NormalizedCancellationResult,
} from "../../contracts/cancellation.js";
import type { NormalizedQuote, QuoteRequest } from "../../contracts/quote.js";
import { ProviderAdapterError } from "../../contracts/provider-error.js";
import type {
  NormalizedServiceabilityResult,
  ServiceabilityRequest,
} from "../../contracts/serviceability.js";
import type {
  NormalizedTrackingResult,
  TrackingRequest,
} from "../../contracts/tracking.js";
import type {
  NormalizedProviderWebhookEvent,
  WebhookParseRequest,
} from "../../contracts/webhook.js";
import type {
  AdapterExecutionContext,
  AdapterOperation,
  AdapterOperationInput,
  AdapterOperationOutput,
  HealthCheckResult,
  ProviderAdapter,
  ProviderAdapterMetadata,
} from "../provider-adapter.types.js";
import {
  MOCK_ADAPTER_VERSION,
  MOCK_BOOKING_ID,
  MOCK_CANCELLATION_ID,
  MOCK_PROVIDER_CODE,
  MOCK_QUOTE_ID,
} from "./mock-provider.constants.js";

const MOCK_CAPABILITIES: ProviderCapability[] = [
  "SERVICEABILITY",
  "AVAILABILITY",
  "PRICING",
  "BOOKING",
  "CANCELLATION",
  "LIVE_TRACKING",
  "TRACKING_URL",
  "WEBHOOKS",
];

const MOCK_OPERATIONS: AdapterOperation[] = [
  "checkServiceability",
  "getAvailability",
  "getQuote",
  "createBooking",
  "getBooking",
  "cancelBooking",
  "getTracking",
  "parseWebhook",
  "healthCheck",
];

export class MockProviderAdapter implements ProviderAdapter {
  readonly metadata: ProviderAdapterMetadata = {
    providerCode: MOCK_PROVIDER_CODE,
    adapterVersion: MOCK_ADAPTER_VERSION,
    supportedCapabilities: MOCK_CAPABILITIES,
    supportedOperations: MOCK_OPERATIONS,
  };

  supportsOperation(operation: AdapterOperation): boolean {
    return MOCK_OPERATIONS.includes(operation);
  }

  async execute<T extends AdapterOperation>(
    operation: T,
    input: AdapterOperationInput<T>,
    ctx: AdapterExecutionContext,
  ): Promise<AdapterOperationOutput<T>> {
    let result: AdapterOperationOutput<T>;
    switch (operation) {
      case "checkServiceability":
        result = this.checkServiceability(
          input as ServiceabilityRequest,
          ctx,
        ) as AdapterOperationOutput<T>;
        break;
      case "getAvailability":
        result = this.getAvailability(
          input as AvailabilityRequest,
          ctx,
        ) as AdapterOperationOutput<T>;
        break;
      case "getQuote":
        result = this.getQuote(
          input as QuoteRequest,
          ctx,
        ) as AdapterOperationOutput<T>;
        break;
      case "createBooking":
        result = this.createBooking(
          input as BookingRequest,
          ctx,
        ) as AdapterOperationOutput<T>;
        break;
      case "getBooking":
        result = this.getBooking(
          input as { providerBookingId: string },
        ) as AdapterOperationOutput<T>;
        break;
      case "cancelBooking":
        result = this.cancelBooking(
          input as CancellationRequest,
          ctx,
        ) as AdapterOperationOutput<T>;
        break;
      case "getTracking":
        result = this.getTracking(
          input as TrackingRequest,
          ctx,
        ) as AdapterOperationOutput<T>;
        break;
      case "parseWebhook":
        result = this.parseWebhook(
          input as WebhookParseRequest,
        ) as AdapterOperationOutput<T>;
        break;
      case "healthCheck":
        result = this.healthCheck() as AdapterOperationOutput<T>;
        break;
      default:
        throw new ProviderAdapterError({
          providerCode: MOCK_PROVIDER_CODE,
          operation,
          category: "PROVIDER_UNSUPPORTED_OPERATION",
          safeMessage: "Unsupported mock adapter operation.",
          requestId: ctx.requestId,
        });
    }
    return result;
  }

  private checkServiceability(
    request: ServiceabilityRequest,
    ctx: AdapterExecutionContext,
  ): NormalizedServiceabilityResult {
    const now = new Date().toISOString();
    if (ctx.testHints?.mockSimulateTimeout) {
      throw new ProviderAdapterError({
        providerCode: MOCK_PROVIDER_CODE,
        operation: "checkServiceability",
        category: "PROVIDER_TIMEOUT",
        safeMessage: "Mock provider timed out.",
        retryable: true,
      });
    }
    if (ctx.testHints?.mockSimulateError) {
      throw new ProviderAdapterError({
        providerCode: MOCK_PROVIDER_CODE,
        operation: "checkServiceability",
        category: "PROVIDER_UNKNOWN_ERROR",
        safeMessage: "Mock provider error.",
        retryable: false,
      });
    }
    if (ctx.testHints?.mockServiceable === false) {
      return {
        serviceable: false,
        providerReference: null,
        reason: "Route not serviceable.",
        availableServices: [],
        checkedAt: now,
      };
    }
    if (request.package.weightKg <= 0) {
      return {
        serviceable: false,
        providerReference: null,
        reason: "Invalid package weight.",
        availableServices: [],
        checkedAt: now,
      };
    }

    return {
      serviceable: true,
      providerReference: request.deliveryReference ?? null,
      reason: null,
      availableServices: [
        {
          serviceId: null,
          serviceCode: "MOCK_BIKE",
          serviceName: "Mock Bike Express",
          vehicleType: "BIKE",
          available: true,
          packageCompatible: true,
          estimatedPickupEta: null,
          estimatedDeliveryEta: null,
        },
      ],
      checkedAt: now,
    };
  }

  private getAvailability(
    _request: AvailabilityRequest,
    ctx: AdapterExecutionContext,
  ) {
    const known = ctx.testHints?.mockAvailabilityKnown ?? true;
    const available = ctx.testHints?.mockAvailabilityAvailable ?? true;
    const availableDriverCount =
      ctx.testHints?.mockAvailableDriverCount !== undefined
        ? ctx.testHints.mockAvailableDriverCount
        : available
          ? 2
          : 0;
    return {
      known,
      available: known ? available : false,
      availableDriverCount: known ? availableDriverCount : null,
      drivers: null,
      checkedAt: new Date().toISOString(),
      reason: known && !available ? "No drivers available." : null,
    };
  }

  private getQuote(
    _request: QuoteRequest,
    ctx: AdapterExecutionContext,
  ): NormalizedQuote {
    const amount =
      ctx.testHints?.mockRequoteAmount ??
      ctx.testHints?.mockQuoteAmount ??
      150;
    const etaMinutes = ctx.testHints?.mockEtaMinutes ?? 45;
    const available = ctx.testHints?.mockQuoteAvailable ?? true;
    return {
      available,
      amount: available ? { amount, currency: "INR" } : null,
      providerQuoteId: MOCK_QUOTE_ID,
      estimatedDeliveryAt: null,
      estimatedDeliveryMinutes: available ? etaMinutes : null,
      breakdown: {
        baseAmount: 120,
        distanceCharge: 20,
        surgeAmount: 0,
        taxAmount: 10,
        otherCharges: 0,
        totalAmount: amount,
      },
      quotedAt: new Date().toISOString(),
      reason: available ? null : "Quote unavailable.",
    };
  }

  private createBooking(
    request: BookingRequest,
    ctx: AdapterExecutionContext,
  ): NormalizedBookingResult {
    if (ctx.testHints?.mockBookingTimeout || ctx.testHints?.mockSimulateTimeout) {
      throw new ProviderAdapterError({
        providerCode: MOCK_PROVIDER_CODE,
        operation: "createBooking",
        category: "PROVIDER_TIMEOUT",
        safeMessage: "Mock provider booking timed out.",
        retryable: true,
      });
    }

    if (ctx.testHints?.mockSimulateError) {
      throw new ProviderAdapterError({
        providerCode: MOCK_PROVIDER_CODE,
        operation: "createBooking",
        category: "PROVIDER_UNKNOWN_ERROR",
        safeMessage: "Mock provider booking error.",
        retryable: false,
      });
    }

    if (
      ctx.testHints?.mockBookingReject ||
      request.package.weightKg > 1000
    ) {
      throw new ProviderAdapterError({
        providerCode: MOCK_PROVIDER_CODE,
        operation: "createBooking",
        category: "PROVIDER_BOOKING_FAILED",
        safeMessage: "Mock provider rejected booking.",
        retryable: false,
      });
    }

    const forcedOutcome = ctx.testHints?.mockBookingOutcome;
    if (forcedOutcome === "FAILED") {
      return {
        success: false,
        outcome: "FAILED",
        providerBookingId: null,
        providerReference: null,
        status: "REJECTED",
        bookedAt: null,
        estimatedPickupAt: null,
        estimatedDeliveryAt: null,
        trackingUrl: null,
        driver: null,
        service: null,
        reason: "Mock provider rejected booking.",
      };
    }

    if (forcedOutcome === "UNKNOWN" || ctx.testHints?.mockBookingUnknown) {
      return {
        success: false,
        outcome: "UNKNOWN",
        providerBookingId: null,
        providerReference: null,
        status: "UNKNOWN",
        bookedAt: null,
        estimatedPickupAt: null,
        estimatedDeliveryAt: null,
        trackingUrl: null,
        driver: null,
        service: null,
        reason: "Mock provider booking outcome unknown.",
      };
    }

    const bookedAmount =
      ctx.testHints?.mockBookingAmount ?? ctx.testHints?.mockQuoteAmount ?? 150;

    return {
      success: true,
      outcome: "BOOKED",
      providerBookingId:
        ctx.testHints?.mockBookingProviderOrderId ?? MOCK_BOOKING_ID,
      providerReference:
        ctx.testHints?.mockBookingProviderReference ??
        request.idempotencyKey ??
        request.deliveryReference ??
        null,
      status: "CONFIRMED",
      bookedAt: new Date().toISOString(),
      estimatedPickupAt: null,
      estimatedDeliveryAt: null,
      trackingUrl: "https://mock-provider.test/track/MOCK-BOOKING-1001",
      driver: null,
      service: {
        serviceCode: request.serviceCode ?? "MOCK_BIKE",
        serviceName: "Mock Bike Express",
        vehicleType: "BIKE",
      },
      amount: { amount: bookedAmount, currency: "INR" },
      reason: null,
    };
  }

  private getBooking(input: {
    providerBookingId: string;
  }): NormalizedBookingResult {
    if (input.providerBookingId !== MOCK_BOOKING_ID) {
      throw new ProviderAdapterError({
        providerCode: MOCK_PROVIDER_CODE,
        operation: "getBooking",
        category: "PROVIDER_NOT_FOUND",
        safeMessage: "Mock booking not found.",
        retryable: false,
      });
    }
    return this.createBooking(
      {
        deliveryReference: "DUTT-MOCK",
        pickup: {
          addressText: "A",
          contactName: "A",
          contactPhone: "+911111111111",
        },
        drop: {
          addressText: "B",
          contactName: "B",
          contactPhone: "+912222222222",
        },
        package: {
          packageType: "FOOD",
          weightKg: 1,
          quantity: 1,
        },
        schedule: { mode: "ASAP", timezone: "Asia/Kolkata" },
        requirements: [],
      },
      { requestId: "mock-get-booking", config: { providerCode: MOCK_PROVIDER_CODE } as never },
    );
  }

  private cancelBooking(
    request: CancellationRequest,
    ctx: AdapterExecutionContext,
  ): NormalizedCancellationResult {
    if (request.providerBookingId !== MOCK_BOOKING_ID) {
      return {
        success: false,
        providerCancellationId: null,
        status: "FAILED",
        reason: "Booking not found.",
        cancelledAt: null,
      };
    }
    if (ctx.testHints?.mockCancellationReject) {
      return {
        success: false,
        outcome: "REJECTED",
        providerCancellationId: null,
        status: "REJECTED",
        reason: "Mock provider rejected cancellation.",
        cancelledAt: null,
      };
    }

    if (ctx.testHints?.mockCancellationUnknown) {
      throw new ProviderAdapterError({
        providerCode: MOCK_PROVIDER_CODE,
        operation: "cancelBooking",
        category: "PROVIDER_TIMEOUT",
        safeMessage: "Mock cancellation timed out.",
        retryable: true,
      });
    }

    return {
      success: true,
      outcome: "CANCELLED",
      providerCancellationId: MOCK_CANCELLATION_ID,
      status: "CANCELLED",
      reason: request.reason ?? null,
      cancelledAt: new Date().toISOString(),
    };
  }

  private getTracking(
    request: TrackingRequest,
    ctx: AdapterExecutionContext,
  ): NormalizedTrackingResult {
    const includeCoordinates = ctx.testHints?.includeTrackingCoordinates === true;
    const status = ctx.testHints?.mockTrackingStatus ?? "IN_TRANSIT";
    let driver: NormalizedDriver | null = null;
    if (ctx.testHints?.mockDriverAssigned === true) {
      driver = {
        providerDriverId: "MOCK-DRIVER-1",
        name: "Mock Driver",
        phone: "+919900000001",
        photoUrl: null,
        providerRating: 4.8,
        vehicleType: "BIKE",
        vehicleNumber: "KA01MOCK1",
        assignedAt: new Date().toISOString(),
      };
    }

    return {
      status,
      latitude: includeCoordinates ? 12.9716 : null,
      longitude: includeCoordinates ? 77.5946 : null,
      accuracyMeters: includeCoordinates ? 10 : null,
      providerTimestamp: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      eta: null,
      trackingUrl: `https://mock-provider.test/track/${request.providerBookingId}`,
      driver,
      providerEventId: "MOCK-EVENT-1",
    };
  }

  private parseWebhook(request: WebhookParseRequest): NormalizedProviderWebhookEvent {
    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};

    return {
      providerCode: MOCK_PROVIDER_CODE,
      providerEventId:
        typeof body.eventId === "string" ? body.eventId : "MOCK-WEBHOOK-1",
      eventType: typeof body.eventType === "string" ? body.eventType : "STATUS_UPDATE",
      providerReference:
        typeof body.reference === "string" ? body.reference : null,
      providerBookingId:
        typeof body.bookingId === "string" ? body.bookingId : MOCK_BOOKING_ID,
      status: typeof body.status === "string" ? body.status : "IN_TRANSIT",
      eventTimestamp: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      driver: null,
      tracking: null,
      metadata: {
        source: "mock",
      },
    };
  }

  private healthCheck(): HealthCheckResult {
    return {
      healthy: true,
      checkedAt: new Date().toISOString(),
      message: null,
    };
  }
}
