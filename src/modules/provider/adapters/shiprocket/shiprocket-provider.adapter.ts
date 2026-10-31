import type { ProviderCapability } from "@prisma/client";
import { env } from "../../../../config/env.js";
import type { BookingRequest } from "../../contracts/booking.js";
import type { CancellationRequest } from "../../contracts/cancellation.js";
import type { NormalizedQuote, QuoteRequest } from "../../contracts/quote.js";
import type {
  NormalizedServiceabilityResult,
  ServiceabilityRequest,
} from "../../contracts/serviceability.js";
import type { TrackingRequest } from "../../contracts/tracking.js";
import { ProviderAdapterError } from "../../contracts/provider-error.js";
import type {
  AdapterExecutionContext,
  AdapterOperation,
  AdapterOperationInput,
  AdapterOperationOutput,
  HealthCheckResult,
  HyperlocalRatesFetchResult,
  ProviderAdapter,
  ProviderAdapterMetadata,
  ProviderHyperlocalRatesAdapter,
  ProviderQuoteProbeResult,
} from "../provider-adapter.types.js";
import {
  ShiprocketAuthService,
  shiprocketAuthService,
} from "./shiprocket-auth.service.js";
import {
  ShiprocketBookingService,
  shiprocketBookingService,
} from "./shiprocket-booking.service.js";
import {
  SHIPROCKET_ADAPTER_VERSION,
  SHIPROCKET_PROVIDER_CODE,
  shiprocketPhase1CancellationPolicy,
} from "./shiprocket.constants.js";
import {
  ShiprocketHyperlocalServiceabilityService,
  shiprocketHyperlocalServiceabilityService,
} from "./shiprocket-hyperlocal.serviceability.js";
import {
  ShiprocketLifecycleService,
  shiprocketLifecycleService,
} from "./shiprocket-lifecycle.service.js";

const BASE_OPERATIONS: AdapterOperation[] = [
  "checkServiceability",
  "getQuote",
  "healthCheck",
];

const BOOKING_OPERATIONS: AdapterOperation[] = [
  "createBooking",
  "getBooking",
  "cancelBooking",
  "getTracking",
];

function bookingLifecycleEnabled(): boolean {
  return env.SHIPROCKET_BOOKING_ENABLED || env.NODE_ENV === "test";
}

function resolveSupportedOperations(): AdapterOperation[] {
  if (!bookingLifecycleEnabled()) {
    return BASE_OPERATIONS;
  }
  return [...BASE_OPERATIONS, ...BOOKING_OPERATIONS];
}

function resolveSupportedCapabilities(): ProviderCapability[] {
  const capabilities: ProviderCapability[] = ["SERVICEABILITY", "PRICING"];
  if (bookingLifecycleEnabled()) {
    capabilities.push("BOOKING", "CANCELLATION", "LIVE_TRACKING");
  }
  return capabilities;
}

function quoteRequestToServiceability(request: QuoteRequest): ServiceabilityRequest {
  return {
    deliveryId: request.deliveryId,
    deliveryReference: request.deliveryReference,
    pickup: request.pickup,
    drop: request.drop,
    package: request.package,
    schedule: request.schedule,
    requirements: request.requirements,
    specialInstructions: request.specialInstructions,
  };
}

function emptyHyperlocalQuote(): NormalizedQuote {
  return {
    available: false,
    amount: null,
    providerQuoteId: null,
    estimatedDeliveryAt: null,
    estimatedDeliveryMinutes: null,
    breakdown: null,
    quotedAt: new Date().toISOString(),
    reason: "No hyperlocal rates returned.",
  };
}

function unsupported(operation: AdapterOperation): never {
  throw new ProviderAdapterError({
    providerCode: SHIPROCKET_PROVIDER_CODE,
    operation,
    category: "PROVIDER_UNSUPPORTED_OPERATION",
    safeMessage: `Shiprocket adapter does not support ${operation}.`,
  });
}

export class ShiprocketProviderAdapter implements ProviderHyperlocalRatesAdapter {
  readonly metadata: ProviderAdapterMetadata;

  constructor(
    private readonly hyperlocal: ShiprocketHyperlocalServiceabilityService = shiprocketHyperlocalServiceabilityService,
    private readonly auth: ShiprocketAuthService = shiprocketAuthService,
    private readonly booking: ShiprocketBookingService = shiprocketBookingService,
    private readonly lifecycle: ShiprocketLifecycleService = shiprocketLifecycleService,
  ) {
    this.metadata = {
      providerCode: SHIPROCKET_PROVIDER_CODE,
      adapterVersion: SHIPROCKET_ADAPTER_VERSION,
      supportedCapabilities: resolveSupportedCapabilities(),
      supportedOperations: resolveSupportedOperations(),
    };
  }

  supportsOperation(operation: AdapterOperation): boolean {
    return resolveSupportedOperations().includes(operation);
  }

  async probeQuote(
    request: QuoteRequest,
    ctx: AdapterExecutionContext,
  ): Promise<Omit<ProviderQuoteProbeResult, "providerCode">> {
    const hyperlocal = await this.fetchHyperlocalRates(
      quoteRequestToServiceability(request),
      ctx,
    );
    const selectedCandidateIndex = 0;
    const first = hyperlocal.candidates[selectedCandidateIndex];
    return {
      quote: first?.quote ?? emptyHyperlocalQuote(),
      candidates: hyperlocal.candidates,
      selectedCandidateIndex,
      serviceability: hyperlocal.serviceability,
      availability: hyperlocal.availability,
      warnings: hyperlocal.warnings,
      providerMetadata: hyperlocal.providerMetadata,
      cancellationPolicy: hyperlocal.cancellationPolicy,
    };
  }

  async fetchHyperlocalRates(
    request: ServiceabilityRequest,
    ctx: AdapterExecutionContext,
  ): Promise<HyperlocalRatesFetchResult> {
    const result = await this.hyperlocal.fetchRates(request, ctx);
    return {
      serviceability: result.serviceability,
      availability: result.availability,
      candidates: result.candidates,
      warnings: result.warnings,
      providerMetadata: {
        shiprocketHyperlocalRates: result.shiprocketHyperlocalRates,
        shiprocketPickupPostcode: result.pickupPostcode,
        shiprocketDeliveryPostcode: result.deliveryPostcode,
        ...(result.pickupCity ? { shiprocketPickupCity: result.pickupCity } : {}),
        ...(result.pickupState ? { shiprocketPickupState: result.pickupState } : {}),
        ...(result.deliveryCity ? { shiprocketDeliveryCity: result.deliveryCity } : {}),
        ...(result.deliveryState
          ? { shiprocketDeliveryState: result.deliveryState }
          : {}),
      },
      cancellationPolicy: shiprocketPhase1CancellationPolicy(),
    };
  }

  async execute<T extends AdapterOperation>(
    operation: T,
    input: AdapterOperationInput<T>,
    ctx: AdapterExecutionContext,
  ): Promise<AdapterOperationOutput<T>> {
    switch (operation) {
      case "healthCheck":
        return (await this.healthCheck(ctx)) as AdapterOperationOutput<T>;
      case "checkServiceability":
        return (await this.checkServiceability(
          input as ServiceabilityRequest,
          ctx,
        )) as AdapterOperationOutput<T>;
      case "getQuote":
        return (await this.getQuote(
          input as QuoteRequest,
          ctx,
        )) as AdapterOperationOutput<T>;
      case "createBooking":
        return (await this.booking.createBooking(
          input as BookingRequest,
          ctx,
        )) as AdapterOperationOutput<T>;
      case "getBooking":
        return (await this.lifecycle.getBooking(
          (input as { providerBookingId: string }).providerBookingId,
          ctx,
        )) as AdapterOperationOutput<T>;
      case "cancelBooking":
        return (await this.lifecycle.cancelBooking(
          input as CancellationRequest,
          ctx,
        )) as AdapterOperationOutput<T>;
      case "getTracking": {
        const trackingInput = input as TrackingRequest;
        return (await this.lifecycle.getTracking(trackingInput.providerBookingId, ctx, {
          awbCode: trackingInput.providerAwbCode ?? null,
          shipmentId: trackingInput.providerShipmentId ?? null,
        })) as AdapterOperationOutput<T>;
      }
      default:
        unsupported(operation);
    }
  }

  private async healthCheck(ctx: AdapterExecutionContext): Promise<HealthCheckResult> {
    const checkedAt = new Date().toISOString();
    try {
      await this.auth.getBearerToken({
        config: ctx.config,
        requestId: ctx.requestId,
      });
      return {
        healthy: true,
        checkedAt,
        message: null,
      };
    } catch (error) {
      const message =
        error instanceof ProviderAdapterError
          ? error.safeMessage
          : "Shiprocket health check failed.";
      return {
        healthy: false,
        checkedAt,
        message,
      };
    }
  }

  private async checkServiceability(
    request: ServiceabilityRequest,
    ctx: AdapterExecutionContext,
  ): Promise<NormalizedServiceabilityResult> {
    const result = await this.fetchHyperlocalRates(request, ctx);
    return result.serviceability;
  }

  private async getQuote(
    request: QuoteRequest,
    ctx: AdapterExecutionContext,
  ): Promise<NormalizedQuote> {
    const probe = await this.probeQuote(request, ctx);
    return probe.quote;
  }
}

export function asProviderAdapter(adapter: ShiprocketProviderAdapter): ProviderAdapter {
  return adapter;
}
