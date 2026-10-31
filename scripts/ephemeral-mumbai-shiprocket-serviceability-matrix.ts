/**
 * Ephemeral LIVE read-only Mumbai route matrix — delete after use.
 * Requires DATABASE_URL/DIRECT_URL → local Postgres (127.0.0.1:5433) on the shell only.
 * Uses Doot Shiprocket fetchHyperlocalRates + Google reverse geocode (via fetchRates).
 */
import { env } from "../src/config/env.js";

const AUTH_LOGIN = "/v1/external/auth/login";
const MUTATING_FRAGMENTS = [
  "/orders/create",
  "/assign/awb",
  "/orders/cancel",
  "/pickup/",
  "/manifest",
];

type LatLng = { latitude: number; longitude: number };

type Site = {
  id: string;
  addressText: string;
};

const PICKUP_1: Site = {
  id: "P1",
  addressText:
    "General Post Office, Chhatrapati Shivaji Terminus Area, Fort, Mumbai, Maharashtra 400001",
};
const PICKUP_2: Site = {
  id: "P2",
  addressText:
    "Collector Office, near Chetna College, Bandra East, Mumbai, Maharashtra 400051",
};
const DELIVERY_1: Site = {
  id: "D1",
  addressText: "Bandra West Post Office, Mumbai, Maharashtra 400050",
};
const DELIVERY_2: Site = {
  id: "D2",
  addressText: "Andheri Head Post Office, Andheri, Mumbai, Maharashtra 400053",
};

const ROUTES: Array<{ label: string; pickup: Site; drop: Site }> = [
  { label: "P1-D1", pickup: PICKUP_1, drop: DELIVERY_1 },
  { label: "P1-D2", pickup: PICKUP_1, drop: DELIVERY_2 },
  { label: "P2-D1", pickup: PICKUP_2, drop: DELIVERY_1 },
  { label: "P2-D2", pickup: PICKUP_2, drop: DELIVERY_2 },
];

const PACKAGE = {
  packageType: "PARCEL" as const,
  weightKg: 0.5,
  lengthCm: 10,
  widthCm: 10,
  heightCm: 10,
  quantity: 1,
};

type Counters = { loginPost: number; serviceabilityGet: number; mutating: number };

function trackFetch(counters: Counters): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST" && url.includes(AUTH_LOGIN)) {
      counters.loginPost += 1;
    }
    if (method === "GET" && url.includes("/courier/serviceability")) {
      counters.serviceabilityGet += 1;
    }
    if (method !== "GET" && method !== "HEAD") {
      if (MUTATING_FRAGMENTS.some((f) => url.includes(f))) {
        counters.mutating += 1;
      }
    }
    return fetch(input, init);
  };
}

async function forwardGeocodeAddress(
  address: string,
): Promise<LatLng & { formattedAddress: string | null }> {
  const apiKey = env.GOOGLE_GEOCODING_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_GEOCODING_API_KEY is not configured.");
  }
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", apiKey);
  const response = await fetch(url.toString());
  const data = (await response.json()) as {
    status: string;
    results?: Array<{
      formatted_address?: string;
      geometry?: { location?: { lat: number; lng: number } };
    }>;
  };
  if (data.status !== "OK" || !data.results?.[0]?.geometry?.location) {
    throw new Error(`Forward geocode failed for address (${data.status}).`);
  }
  const loc = data.results[0].geometry!.location!;
  return {
    latitude: loc.lat,
    longitude: loc.lng,
    formattedAddress: data.results[0].formatted_address ?? null,
  };
}

function sanitizeRawEntry(entry: unknown): Record<string, unknown> {
  if (!entry || typeof entry !== "object") {
    return { raw: entry };
  }
  const row = entry as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of [
    "courier_name",
    "courier_company_id",
    "courier_id",
    "rate_id",
    "rates",
    "rate",
    "eta",
    "etd",
    "estimated_delivery_days",
  ]) {
    if (key in row) {
      out[key] = row[key];
    }
  }
  return out;
}

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || !dbUrl.includes("127.0.0.1:5433")) {
    throw new Error(
      "Refusing to run: set DATABASE_URL to local 127.0.0.1:5433 only (do not use Supabase).",
    );
  }

  const geocoded: Record<string, LatLng & { formattedAddress: string | null }> = {};
  for (const site of [PICKUP_1, PICKUP_2, DELIVERY_1, DELIVERY_2]) {
    geocoded[site.id] = await forwardGeocodeAddress(site.addressText);
  }

  const { PrismaClient } = await import("@prisma/client");
  const { disconnectDatabase } = await import("../src/config/database.js");
  await disconnectDatabase();
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const provider = await prisma.provider.findUnique({ where: { code: "SHIPROCKET" } });
  if (!provider) {
    throw new Error("SHIPROCKET provider not found on local DB.");
  }

  const { ProviderConfigResolver } =
    await import("../src/modules/provider/adapters/provider-config-resolver.js");
  const { ShiprocketAuthService } =
    await import("../src/modules/provider/adapters/shiprocket/shiprocket-auth.service.js");
  const { ShiprocketHyperlocalServiceabilityService } =
    await import("../src/modules/provider/adapters/shiprocket/shiprocket-hyperlocal.serviceability.js");
  const { ShiprocketProviderAdapter } =
    await import("../src/modules/provider/adapters/shiprocket/shiprocket-provider.adapter.js");
  const { ProviderHttpClient } =
    await import("../src/modules/provider/adapters/provider-http-client.js");
  const { GoogleGeocodingClient } =
    await import("../src/infrastructure/geocoding/google-geocoding.client.js");

  const config = await new ProviderConfigResolver().resolveById(provider.id);
  const counters: Counters = { loginPost: 0, serviceabilityGet: 0, mutating: 0 };
  const http = new ProviderHttpClient(trackFetch(counters));
  const geocoding = new GoogleGeocodingClient(fetch);
  const auth = new ShiprocketAuthService(http);
  auth.clearCacheForTests();
  const hyperlocal = new ShiprocketHyperlocalServiceabilityService(
    http,
    auth,
    geocoding,
  );
  const adapter = new ShiprocketProviderAdapter(hyperlocal, auth);

  const loginBefore = counters.loginPost;
  const results: unknown[] = [];

  const { buildHyperlocalServiceabilityPath } =
    await import("../src/modules/provider/adapters/shiprocket/shiprocket-hyperlocal.query.js");
  const { shiprocketAuthenticatedReadRequest } =
    await import("../src/modules/provider/adapters/shiprocket/shiprocket-authenticated-http.util.js");
  const { parseShiprocketHyperlocalServiceability } =
    await import("../src/modules/provider/adapters/shiprocket/shiprocket-hyperlocal.parser.js");

  for (const route of ROUTES) {
    const pickupGeo = geocoded[route.pickup.id]!;
    const dropGeo = geocoded[route.drop.id]!;
    const started = Date.now();

    const pickupPin = await geocoding.reverseGeocode(
      pickupGeo.latitude,
      pickupGeo.longitude,
    );
    const dropPin = await geocoding.reverseGeocode(dropGeo.latitude, dropGeo.longitude);
    const path = buildHyperlocalServiceabilityPath({
      pickupPostcode: pickupPin.postalCode,
      deliveryPostcode: dropPin.postalCode,
      latFrom: pickupGeo.latitude,
      longFrom: pickupGeo.longitude,
      latTo: dropGeo.latitude,
      longTo: dropGeo.longitude,
      weightKg: PACKAGE.weightKg,
      cod: "0",
    });

    const httpResponse = await shiprocketAuthenticatedReadRequest({
      http,
      auth,
      config,
      requestId: `mumbai-${route.label}`,
      operation: "checkServiceability",
      resourceLabel: "serviceability",
      request: { method: "GET", path, headers: { accept: "application/json" } },
    });
    const latencyMs = Date.now() - started;
    const parsed = parseShiprocketHyperlocalServiceability(httpResponse.data);

    const rawData = httpResponse.data;
    const sanitizedRawResponse =
      rawData && typeof rawData === "object"
        ? {
            status: (rawData as Record<string, unknown>).status,
            message: (rawData as Record<string, unknown>).message,
            data: Array.isArray((rawData as Record<string, unknown>).data)
              ? ((rawData as Record<string, unknown>).data as unknown[]).map(
                  sanitizeRawEntry,
                )
              : (rawData as Record<string, unknown>).data,
          }
        : rawData;

    const rawEntries = parsed.rawEntries ?? [];
    const options = parsed.candidates.map((c, index) => ({
      index,
      courierName: c.courierName,
      shiprocketCourierCompanyId:
        (rawEntries[index] as Record<string, unknown> | undefined)
          ?.courier_company_id ?? null,
      providerQuoteId: c.providerQuoteId,
      estimatedDeliveryMinutes: c.estimatedDeliveryMinutes,
      priceInr: c.amountInr,
      currency: "INR",
      sanitizedRaw: sanitizeRawEntry(rawEntries[index]),
    }));

    const rawDataArrayLength = Array.isArray((rawData as Record<string, unknown>)?.data)
      ? ((rawData as Record<string, unknown>).data as unknown[]).length
      : 0;

    let adapterError: string | null = null;
    let duttAdapterCandidateCount: number | null = null;
    let duttAdapterServiceable: boolean | null = null;
    try {
      const adapterResult = await adapter.fetchHyperlocalRates(
        {
          deliveryReference: `mumbai-matrix-${route.label}`,
          pickup: {
            addressText: route.pickup.addressText,
            contactName: "Mumbai Test Pickup",
            contactPhoneCountryCode: "+91",
            contactPhoneNumber: "9999999991",
            instructions: null,
            latitude: pickupGeo.latitude,
            longitude: pickupGeo.longitude,
          },
          drop: {
            addressText: route.drop.addressText,
            contactName: "Mumbai Test Drop",
            contactPhoneCountryCode: "+91",
            contactPhoneNumber: "9999999992",
            instructions: null,
            latitude: dropGeo.latitude,
            longitude: dropGeo.longitude,
          },
          package: { ...PACKAGE, description: null },
          schedule: {
            mode: "ASAP",
            timezone: "Asia/Kolkata",
            scheduledAt: null,
            windowStart: null,
            windowEnd: null,
          },
          requirements: [],
          specialInstructions: null,
        },
        { requestId: `mumbai-adapter-${route.label}`, config },
      );
      duttAdapterCandidateCount = adapterResult.candidates.length;
      duttAdapterServiceable = adapterResult.serviceability.serviceable;
    } catch (error) {
      adapterError =
        error instanceof Error ? error.message.slice(0, 200) : "adapter error";
    }

    const candidatesLostOrCollapsed =
      duttAdapterCandidateCount != null && duttAdapterCandidateCount !== options.length
        ? `parser options (${options.length}) vs adapter candidates (${duttAdapterCandidateCount})`
        : rawDataArrayLength > 0 && options.length < rawDataArrayLength
          ? `raw data rows (${rawDataArrayLength}) vs parsed options (${options.length}) — rows without rates dropped by parser`
          : null;

    results.push({
      route: route.label,
      pickupAddress: route.pickup.addressText,
      deliveryAddress: route.drop.addressText,
      pickupCoordinates: {
        latitude: pickupGeo.latitude,
        longitude: pickupGeo.longitude,
      },
      deliveryCoordinates: { latitude: dropGeo.latitude, longitude: dropGeo.longitude },
      forwardGeocodeFormatted: {
        pickup: pickupGeo.formattedAddress,
        drop: dropGeo.formattedAddress,
      },
      reverseGeocodePinCodes: {
        pickup: pickupPin.postalCode,
        delivery: dropPin.postalCode,
      },
      httpStatus: httpResponse.status,
      latencyMs,
      shiprocketApiStatus:
        (rawData as Record<string, unknown> | undefined)?.status ?? null,
      shiprocketApiMessage:
        (rawData as Record<string, unknown> | undefined)?.message ?? null,
      parserSuccess: parsed.success,
      serviceable: parsed.success && options.length > 0,
      optionCount: options.length,
      shiprocketRawDataRowCount: rawDataArrayLength,
      duttAdapterCandidateCount,
      duttAdapterServiceable,
      candidatesLostOrCollapsed,
      duttProviderCode: "SHIPROCKET",
      options,
      sanitizedRawResponse,
      duttAdapterFetchHyperlocalRatesError: adapterError,
    });
  }

  console.log(
    JSON.stringify(
      {
        packageUsed: PACKAGE,
        schedule: { mode: "ASAP", timezone: "Asia/Kolkata" },
        counters: {
          loginPostBeforeMatrix: loginBefore,
          loginPostAfterMatrix: counters.loginPost,
          serviceabilityGetTotal: counters.serviceabilityGet,
          mutatingRequests: counters.mutating,
        },
        tests: results,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
  await disconnectDatabase();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
