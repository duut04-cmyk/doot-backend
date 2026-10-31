import type { AvailabilityResult } from "../../contracts/availability.js";
import type { NormalizedQuote } from "../../contracts/quote.js";
import type { NormalizedServiceabilityResult } from "../../contracts/serviceability.js";
import type { ServiceabilityRequest } from "../../contracts/serviceability.js";
import { ProviderAdapterError } from "../../contracts/provider-error.js";
import {
  GoogleGeocodingClient,
  googleGeocodingClient,
  requireCoordinates,
} from "../../../../infrastructure/geocoding/google-geocoding.client.js";
import {
  GeocodingValidationError,
  toGeocodingIneligibleError,
} from "../../../../infrastructure/geocoding/google-geocoding.errors.js";
import type { AdapterExecutionContext } from "../provider-adapter.types.js";
import { ProviderHttpClient } from "../provider-http-client.js";
import {
  ShiprocketAuthService,
  shiprocketAuthService,
} from "./shiprocket-auth.service.js";
import { shiprocketAuthenticatedReadRequest } from "./shiprocket-authenticated-http.util.js";
import { SHIPROCKET_JSON_READ_HEADERS } from "./shiprocket.constants.js";
import { buildHyperlocalServiceabilityPath } from "./shiprocket-hyperlocal.query.js";
import { parseShiprocketHyperlocalServiceability } from "./shiprocket-hyperlocal.parser.js";
import type { ParsedHyperlocalRateCandidate } from "./shiprocket.types.js";

export type ShiprocketHyperlocalFetchResult = {
  serviceability: NormalizedServiceabilityResult;
  availability: AvailabilityResult;
  candidates: Array<{
    quote: NormalizedQuote;
    providerMetadata: Record<string, unknown>;
  }>;
  warnings: string[];
  shiprocketHyperlocalRates: unknown[];
  pickupPostcode: string;
  deliveryPostcode: string;
  pickupCity: string | null;
  pickupState: string | null;
  deliveryCity: string | null;
  deliveryState: string | null;
};

function defaultUnknownAvailability(): AvailabilityResult {
  return {
    known: false,
    available: false,
    availableDriverCount: null,
    drivers: null,
    checkedAt: new Date().toISOString(),
    reason: "Driver availability not provided by Shiprocket hyperlocal",
  };
}

function toQuote(candidate: ParsedHyperlocalRateCandidate): NormalizedQuote {
  const now = new Date().toISOString();
  return {
    available: true,
    amount: { amount: candidate.amountInr, currency: "INR" },
    providerQuoteId: candidate.providerQuoteId,
    estimatedDeliveryAt: null,
    estimatedDeliveryMinutes: candidate.estimatedDeliveryMinutes,
    breakdown: null,
    quotedAt: now,
    reason: null,
  };
}

export class ShiprocketHyperlocalServiceabilityService {
  constructor(
    private readonly http: ProviderHttpClient = new ProviderHttpClient(),
    private readonly auth: ShiprocketAuthService = shiprocketAuthService,
    private readonly geocoding: GoogleGeocodingClient = googleGeocodingClient,
  ) {}

  async fetchRates(
    request: ServiceabilityRequest,
    ctx: AdapterExecutionContext,
  ): Promise<ShiprocketHyperlocalFetchResult> {
    const providerCode = ctx.config.providerCode;

    try {
      const pickupCoords = requireCoordinates(
        "Pickup",
        request.pickup.latitude,
        request.pickup.longitude,
      );
      const dropCoords = requireCoordinates(
        "Drop",
        request.drop.latitude,
        request.drop.longitude,
      );

      const [pickupGeo, dropGeo] = await Promise.all([
        this.geocoding.reverseGeocode(pickupCoords.latitude, pickupCoords.longitude),
        this.geocoding.reverseGeocode(dropCoords.latitude, dropCoords.longitude),
      ]);

      const path = buildHyperlocalServiceabilityPath({
        pickupPostcode: pickupGeo.postalCode,
        deliveryPostcode: dropGeo.postalCode,
        latFrom: pickupCoords.latitude,
        longFrom: pickupCoords.longitude,
        latTo: dropCoords.latitude,
        longTo: dropCoords.longitude,
        weightKg: request.package.weightKg,
        cod: "0",
      });

      const response = await shiprocketAuthenticatedReadRequest({
        http: this.http,
        auth: this.auth,
        config: ctx.config,
        requestId: ctx.requestId,
        operation: "checkServiceability",
        resourceLabel: "serviceability",
        allowErrorResponseBody: true,
        request: {
          method: "GET",
          path,
          headers: SHIPROCKET_JSON_READ_HEADERS,
        },
      });

      if (response.status === 498) {
        throw new ProviderAdapterError({
          providerCode,
          operation: "checkServiceability",
          category: "PROVIDER_SERVICE_UNAVAILABLE",
          safeMessage: "Shiprocket access was denied by edge infrastructure.",
          retryable: false,
          requestId: ctx.requestId,
        });
      }

      if (response.status === 401 || response.status === 403) {
        throw new ProviderAdapterError({
          providerCode,
          operation: "checkServiceability",
          category: "PROVIDER_AUTHENTICATION_ERROR",
          safeMessage: "Shiprocket serviceability authentication failed.",
          requestId: ctx.requestId,
        });
      }

      if (response.status >= 500) {
        throw new ProviderAdapterError({
          providerCode,
          operation: "checkServiceability",
          category: "PROVIDER_SERVICE_UNAVAILABLE",
          safeMessage: "Shiprocket serviceability is temporarily unavailable.",
          requestId: ctx.requestId,
        });
      }

      if (response.status >= 400) {
        throw new ProviderAdapterError({
          providerCode,
          operation: "checkServiceability",
          category: "PROVIDER_VALIDATION_ERROR",
          safeMessage: "Shiprocket rejected the serviceability request.",
          requestId: ctx.requestId,
        });
      }

      const parsed = parseShiprocketHyperlocalServiceability(response.data);
      if (parsed.malformed || !parsed.success) {
        throw new ProviderAdapterError({
          providerCode,
          operation: "checkServiceability",
          category: "PROVIDER_UNKNOWN_ERROR",
          safeMessage: "Shiprocket returned an unexpected serviceability response.",
          requestId: ctx.requestId,
        });
      }

      const checkedAt = new Date().toISOString();
      const serviceable = parsed.candidates.length > 0;
      const serviceability: NormalizedServiceabilityResult = {
        serviceable,
        providerReference: null,
        reason: serviceable
          ? null
          : (parsed.providerMessage ??
            "No hyperlocal couriers available for this route."),
        availableServices: [],
        checkedAt,
      };

      const candidates = parsed.candidates.map((candidate) => ({
        quote: toQuote(candidate),
        providerMetadata: {
          shiprocketHyperlocalRate: candidate.raw,
          shiprocketCourierName: candidate.courierName,
          shiprocketPickupPostcode: pickupGeo.postalCode,
          shiprocketDeliveryPostcode: dropGeo.postalCode,
          ...(pickupGeo.city ? { shiprocketPickupCity: pickupGeo.city } : {}),
          ...(pickupGeo.state ? { shiprocketPickupState: pickupGeo.state } : {}),
          ...(dropGeo.city ? { shiprocketDeliveryCity: dropGeo.city } : {}),
          ...(dropGeo.state ? { shiprocketDeliveryState: dropGeo.state } : {}),
        },
      }));

      return {
        serviceability,
        availability: defaultUnknownAvailability(),
        candidates,
        warnings: [],
        shiprocketHyperlocalRates: parsed.rawEntries,
        pickupPostcode: pickupGeo.postalCode,
        deliveryPostcode: dropGeo.postalCode,
        pickupCity: pickupGeo.city,
        pickupState: pickupGeo.state,
        deliveryCity: dropGeo.city,
        deliveryState: dropGeo.state,
      };
    } catch (error) {
      if (error instanceof GeocodingValidationError) {
        throw toGeocodingIneligibleError(
          providerCode,
          error.safeMessage,
          ctx.requestId,
        );
      }
      throw error;
    }
  }
}

export const shiprocketHyperlocalServiceabilityService =
  new ShiprocketHyperlocalServiceabilityService();
