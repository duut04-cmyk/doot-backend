import type { ProviderCapability } from "@prisma/client";
import type { AvailabilityRequest, AvailabilityResult } from "../contracts/availability.js";
import type { BookingRequest, NormalizedBookingResult } from "../contracts/booking.js";
import type { CancellationRequest, NormalizedCancellationResult } from "../contracts/cancellation.js";
import type {
  CancellationPolicy,
  CancellationPolicyRequest,
} from "../contracts/cancellation-policy.js";
import type { NormalizedQuote, QuoteRequest } from "../contracts/quote.js";
import type {
  NormalizedServiceabilityResult,
  ServiceabilityRequest,
} from "../contracts/serviceability.js";
import type { NormalizedTrackingResult, TrackingRequest } from "../contracts/tracking.js";
import type {
  NormalizedProviderWebhookEvent,
  WebhookParseRequest,
} from "../contracts/webhook.js";
import type { ProviderRuntimeConfig } from "./provider-config.types.js";

export const ADAPTER_OPERATIONS = [
  "checkServiceability",
  "getAvailability",
  "getQuote",
  "createBooking",
  "getBooking",
  "cancelBooking",
  "getCancellationPolicy",
  "getTracking",
  "parseWebhook",
  "healthCheck",
] as const;

export type AdapterOperation = (typeof ADAPTER_OPERATIONS)[number];

export type ProviderAdapterMetadata = {
  providerCode: string;
  adapterVersion: string;
  supportedCapabilities: ProviderCapability[];
  supportedOperations: AdapterOperation[];
};

export type AdapterExecutionContext = {
  requestId: string;
  config: ProviderRuntimeConfig;
  /** Test-only hints — never set from customer HTTP input. */
  testHints?: {
    includeTrackingCoordinates?: boolean;
    mockQuoteAmount?: number;
    mockEtaMinutes?: number;
    mockAvailabilityKnown?: boolean;
    mockAvailabilityAvailable?: boolean;
    mockAvailableDriverCount?: number | null;
    mockServiceable?: boolean;
    mockQuoteAvailable?: boolean;
    mockSimulateTimeout?: boolean;
    mockSimulateError?: boolean;
    mockBookingOutcome?: "BOOKED" | "FAILED" | "UNKNOWN";
    mockBookingReject?: boolean;
    mockBookingTimeout?: boolean;
    mockBookingUnknown?: boolean;
    mockBookingAmount?: number;
    mockBookingProviderOrderId?: string;
    mockBookingProviderReference?: string;
    mockRequoteAmount?: number;
    mockDriverAssigned?: boolean;
    mockDriverUnknown?: boolean;
    mockTrackingStatus?: string;
    mockCancellationReject?: boolean;
    mockCancellationUnknown?: boolean;
    mockCancellationPolicy?: CancellationPolicy;
    mockCancellationPolicyKnown?: boolean;
  };
};

export type HealthCheckResult = {
  healthy: boolean;
  checkedAt: string;
  message: string | null;
};

export type AdapterOperationInputMap = {
  checkServiceability: ServiceabilityRequest;
  getAvailability: AvailabilityRequest;
  getQuote: QuoteRequest;
  createBooking: BookingRequest;
  getBooking: { providerBookingId: string };
  cancelBooking: CancellationRequest;
  getCancellationPolicy: CancellationPolicyRequest;
  getTracking: TrackingRequest;
  parseWebhook: WebhookParseRequest;
  healthCheck: Record<string, never>;
};

export type AdapterOperationOutputMap = {
  checkServiceability: NormalizedServiceabilityResult;
  getAvailability: AvailabilityResult;
  getQuote: NormalizedQuote;
  createBooking: NormalizedBookingResult;
  getBooking: NormalizedBookingResult;
  cancelBooking: NormalizedCancellationResult;
  getCancellationPolicy: CancellationPolicy;
  getTracking: NormalizedTrackingResult;
  parseWebhook: NormalizedProviderWebhookEvent;
  healthCheck: HealthCheckResult;
};

export type AdapterOperationInput<T extends AdapterOperation> =
  AdapterOperationInputMap[T];

export type AdapterOperationOutput<T extends AdapterOperation> =
  AdapterOperationOutputMap[T];

export interface ProviderAdapter {
  readonly metadata: ProviderAdapterMetadata;
  supportsOperation(operation: AdapterOperation): boolean;
  execute<T extends AdapterOperation>(
    operation: T,
    input: AdapterOperationInput<T>,
    ctx: AdapterExecutionContext,
  ): Promise<AdapterOperationOutput<T>>;
}

export type ProviderQuoteProbeResult = {
  providerCode: string;
  quote: NormalizedQuote;
  serviceability: NormalizedServiceabilityResult;
  availability: AvailabilityResult;
  warnings: string[];
  providerMetadata: Record<string, unknown>;
  cancellationPolicy?: CancellationPolicy;
};

export interface ProviderQuoteProbeAdapter extends ProviderAdapter {
  probeQuote(
    input: QuoteRequest,
    ctx: AdapterExecutionContext,
  ): Promise<ProviderQuoteProbeResult>;
}

export function isQuoteProbeAdapter(
  adapter: ProviderAdapter,
): adapter is ProviderQuoteProbeAdapter {
  return typeof (adapter as ProviderQuoteProbeAdapter).probeQuote === "function";
}
