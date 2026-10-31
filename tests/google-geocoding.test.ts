import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config/env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config/env.js")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      GOOGLE_GEOCODING_API_KEY: "test-geocode-key",
    },
  };
});

import {
  GoogleGeocodingClient,
  parseIndianPostalCodeFromGeocodeResponse,
  requireCoordinates,
} from "../src/infrastructure/geocoding/google-geocoding.client.js";
import { GeocodingValidationError } from "../src/infrastructure/geocoding/google-geocoding.errors.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/google");

describe("GoogleGeocodingClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("parses a 6-digit Indian postal code from fixture JSON", () => {
    const fixture = JSON.parse(
      readFileSync(join(fixtureDir, "geocode-postal-code.json"), "utf8"),
    );
    const result = parseIndianPostalCodeFromGeocodeResponse(fixture);
    expect(result.postalCode).toBe("110001");
    expect(result.city).toBe("New Delhi");
    expect(result.state).toBeNull();
  });

  it("requires coordinates before geocoding", () => {
    expect(() => requireCoordinates("Pickup", null, 77.2)).toThrow(
      GeocodingValidationError,
    );
  });

  it("reverseGeocode calls Google API with server key from env", async () => {
    const fixture = JSON.parse(
      readFileSync(join(fixtureDir, "geocode-postal-code.json"), "utf8"),
    );
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("maps.googleapis.com/maps/api/geocode/json");
      expect(url).toContain("latlng=28.6315%2C77.2167");
      expect(url).toContain("key=test-geocode-key");
      return new Response(JSON.stringify(fixture), { status: 200 });
    });

    const client = new GoogleGeocodingClient(fetchMock as typeof fetch);
    const result = await client.reverseGeocode(28.6315, 77.2167);
    expect(result.postalCode).toBe("110001");
    expect(result.city).toBe("New Delhi");
    expect(result.state).toBeNull();
  });
});
