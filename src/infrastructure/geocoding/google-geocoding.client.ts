import { env } from "../../config/env.js";
import { GeocodingValidationError } from "./google-geocoding.errors.js";

const INDIAN_POSTAL_CODE = /^\d{6}$/;

export type ReverseGeocodeResult = {
  postalCode: string;
  formattedAddress: string | null;
  city: string | null;
  state: string | null;
};

type GoogleGeocodeResponse = {
  status: string;
  results?: Array<{
    formatted_address?: string;
    address_components?: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>;
  }>;
  error_message?: string;
};

export function parseIndianPostalCodeFromGeocodeResponse(
  data: GoogleGeocodeResponse,
): ReverseGeocodeResult {
  if (data.status !== "OK" || !data.results?.length) {
    throw new GeocodingValidationError(
      data.error_message ?? "Reverse geocoding did not return a result.",
    );
  }

  for (const result of data.results) {
    const postalComponent = result.address_components?.find((component) =>
      component.types.includes("postal_code"),
    );
    if (!postalComponent) {
      continue;
    }
    const candidate = postalComponent.long_name.replace(/\s/g, "");
    if (INDIAN_POSTAL_CODE.test(candidate)) {
      const components = result.address_components ?? [];
      const findType = (type: string) =>
        components
          .find((component) => component.types.includes(type))
          ?.long_name?.trim() ?? null;
      const city =
        findType("locality") ??
        findType("administrative_area_level_2") ??
        findType("sublocality");
      const state = findType("administrative_area_level_1");
      return {
        postalCode: candidate,
        formattedAddress: result.formatted_address ?? null,
        city: city && city.length > 0 ? city : null,
        state: state && state.length > 0 ? state : null,
      };
    }
  }

  throw new GeocodingValidationError(
    "Reverse geocoding did not return a valid 6-digit Indian postal code.",
  );
}

export class GoogleGeocodingClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async reverseGeocode(
    latitude: number,
    longitude: number,
  ): Promise<ReverseGeocodeResult> {
    const apiKey = env.GOOGLE_GEOCODING_API_KEY;
    if (!apiKey) {
      throw new GeocodingValidationError("Google Geocoding API key is not configured.");
    }

    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("latlng", `${latitude},${longitude}`);
    url.searchParams.set("key", apiKey);

    const response = await this.fetchImpl(url.toString(), { method: "GET" });
    const text = await response.text();
    let parsed: GoogleGeocodeResponse;
    try {
      parsed = JSON.parse(text) as GoogleGeocodeResponse;
    } catch {
      throw new GeocodingValidationError("Reverse geocoding returned invalid JSON.");
    }

    if (!response.ok) {
      throw new GeocodingValidationError(
        parsed.error_message ?? "Reverse geocoding request failed.",
      );
    }

    return parseIndianPostalCodeFromGeocodeResponse(parsed);
  }
}

export const googleGeocodingClient = new GoogleGeocodingClient();

export function requireCoordinates(
  label: string,
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): { latitude: number; longitude: number } {
  if (
    latitude == null ||
    longitude == null ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    throw new GeocodingValidationError(`${label} coordinates are required.`);
  }
  return { latitude, longitude };
}
