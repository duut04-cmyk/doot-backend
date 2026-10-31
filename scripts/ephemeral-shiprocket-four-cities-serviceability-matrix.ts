/**
 * Ephemeral LIVE read-only: Bengaluru, Hyderabad, Pune, Chandigarh (4 routes each).
 * DATABASE_URL/DIRECT_URL → local 127.0.0.1:5433 on shell only.
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

type Site = { id: string; addressText: string };

type CityMatrix = {
  city: string;
  pickup1: Site;
  pickup2: Site;
  delivery1: Site;
  delivery2: Site;
};

const CITIES: CityMatrix[] = [
  {
    city: "bengaluru",
    pickup1: {
      id: "P1",
      addressText:
        "General Post Office, Raj Bhavan Road, Sampangi Rama Nagar, Bengaluru, Karnataka 560001",
    },
    pickup2: {
      id: "P2",
      addressText:
        "Indiranagar Post Office, 100 Feet Road, Indiranagar, Bengaluru, Karnataka 560038",
    },
    delivery1: {
      id: "D1",
      addressText: "Koramangala Post Office, Bengaluru, Karnataka 560034",
    },
    delivery2: {
      id: "D2",
      addressText: "Whitefield Post Office, Bengaluru, Karnataka 560066",
    },
  },
  {
    city: "hyderabad",
    pickup1: {
      id: "P1",
      addressText: "General Post Office, Afzal Gunj, Hyderabad, Telangana 500012",
    },
    pickup2: {
      id: "P2",
      addressText: "HITEC City, Madhapur, Hyderabad, Telangana 500081",
    },
    delivery1: {
      id: "D1",
      addressText: "Head Post Office, Secunderabad, Telangana 500003",
    },
    delivery2: {
      id: "D2",
      addressText:
        "Kukatpally Head Post Office, Kukatpally, Hyderabad, Telangana 500072",
    },
  },
  {
    city: "pune",
    pickup1: {
      id: "P1",
      addressText:
        "General Post Office, Sardar Patel Road, Camp, Pune, Maharashtra 411001",
    },
    pickup2: {
      id: "P2",
      addressText: "Aundh Post Office, Pune, Maharashtra 411007",
    },
    delivery1: {
      id: "D1",
      addressText: "Koregaon Park, Pune, Maharashtra 411001",
    },
    delivery2: {
      id: "D2",
      addressText: "Baner, Pune, Maharashtra 411045",
    },
  },
  {
    city: "chandigarh",
    pickup1: {
      id: "P1",
      addressText: "General Post Office, Sector 17, Chandigarh 160017",
    },
    pickup2: {
      id: "P2",
      addressText: "Post Office, Sector 22, Chandigarh 160022",
    },
    delivery1: {
      id: "D1",
      addressText: "Post Office, Sector 35, Chandigarh 160035",
    },
    delivery2: {
      id: "D2",
      addressText: "Manimajra Post Office, Chandigarh 160101",
    },
  },
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
): Promise<{ latitude: number; longitude: number; formattedAddress: string | null }> {
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
    throw new Error(
      `Forward geocode failed (${data.status}) for: ${address.slice(0, 80)}`,
    );
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

function summarizeCity(city: string, routes: Array<Record<string, unknown>>) {
  const serviceableRoutes = routes.filter((r) => r.serviceable === true);
  const prices: number[] = [];
  const names = new Set<string>();
  let totalCandidates = 0;
  let multiCandidateRoute = false;
  for (const r of routes) {
    const count = (r.optionCount as number) ?? 0;
    totalCandidates += count;
    if (count > 1) {
      multiCandidateRoute = true;
    }
    for (const opt of (r.options as Array<{
      courierName?: string | null;
      priceInr?: number;
    }>) ?? []) {
      if (opt.courierName) {
        names.add(opt.courierName);
      }
      if (typeof opt.priceInr === "number") {
        prices.push(opt.priceInr);
      }
    }
  }
  return {
    city,
    routesTested: routes.length,
    serviceableRoutes: serviceableRoutes.length,
    nonServiceableRoutes: routes.length - serviceableRoutes.length,
    totalCourierCandidates: totalCandidates,
    distinctCourierNames: [...names],
    lowestPriceInr: prices.length ? Math.min(...prices) : null,
    highestPriceInr: prices.length ? Math.max(...prices) : null,
    anyRouteMultipleCandidates: multiCandidateRoute,
  };
}

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || !dbUrl.includes("127.0.0.1:5433")) {
    throw new Error("Refusing to run: DATABASE_URL must be local 127.0.0.1:5433 only.");
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
  const { buildHyperlocalServiceabilityPath } =
    await import("../src/modules/provider/adapters/shiprocket/shiprocket-hyperlocal.query.js");
  const { shiprocketAuthenticatedReadRequest } =
    await import("../src/modules/provider/adapters/shiprocket/shiprocket-authenticated-http.util.js");
  const { parseShiprocketHyperlocalServiceability } =
    await import("../src/modules/provider/adapters/shiprocket/shiprocket-hyperlocal.parser.js");

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
  const cityResults: Array<{ city: string; routes: unknown[]; summary: unknown }> = [];

  for (const cityDef of CITIES) {
    const sites = [
      cityDef.pickup1,
      cityDef.pickup2,
      cityDef.delivery1,
      cityDef.delivery2,
    ];
    const geocoded: Record<
      string,
      { latitude: number; longitude: number; formattedAddress: string | null }
    > = {};
    for (const site of sites) {
      geocoded[site.id] = await forwardGeocodeAddress(site.addressText);
    }

    const routeDefs = [
      { label: "P1-D1", pickup: cityDef.pickup1, drop: cityDef.delivery1 },
      { label: "P1-D2", pickup: cityDef.pickup1, drop: cityDef.delivery2 },
      { label: "P2-D1", pickup: cityDef.pickup2, drop: cityDef.delivery1 },
      { label: "P2-D2", pickup: cityDef.pickup2, drop: cityDef.delivery2 },
    ];

    const routes: unknown[] = [];

    for (const route of routeDefs) {
      const pickupGeo = geocoded[route.pickup.id]!;
      const dropGeo = geocoded[route.drop.id]!;
      const started = Date.now();
      const pickupPin = await geocoding.reverseGeocode(
        pickupGeo.latitude,
        pickupGeo.longitude,
      );
      const dropPin = await geocoding.reverseGeocode(
        dropGeo.latitude,
        dropGeo.longitude,
      );
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
        requestId: `${cityDef.city}-${route.label}`,
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

      const rawDataArrayLength = Array.isArray(
        (rawData as Record<string, unknown>)?.data,
      )
        ? ((rawData as Record<string, unknown>).data as unknown[]).length
        : 0;

      let adapterError: string | null = null;
      let duttAdapterCandidateCount: number | null = null;
      let duttAdapterServiceable: boolean | null = null;
      let duttServiceabilityReason: string | null = null;
      try {
        const adapterResult = await adapter.fetchHyperlocalRates(
          {
            deliveryReference: `${cityDef.city}-${route.label}`,
            pickup: {
              addressText: route.pickup.addressText,
              contactName: "Test Pickup",
              contactPhoneCountryCode: "+91",
              contactPhoneNumber: "9999999991",
              instructions: null,
              latitude: pickupGeo.latitude,
              longitude: pickupGeo.longitude,
            },
            drop: {
              addressText: route.drop.addressText,
              contactName: "Test Drop",
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
          { requestId: `${cityDef.city}-adapter-${route.label}`, config },
        );
        duttAdapterCandidateCount = adapterResult.candidates.length;
        duttAdapterServiceable = adapterResult.serviceability.serviceable;
        duttServiceabilityReason = adapterResult.serviceability.reason;
      } catch (error) {
        adapterError =
          error instanceof Error ? error.message.slice(0, 200) : "adapter error";
      }

      const candidatesLostOrCollapsed =
        duttAdapterCandidateCount != null &&
        duttAdapterCandidateCount !== options.length
          ? `parser (${options.length}) vs adapter (${duttAdapterCandidateCount})`
          : rawDataArrayLength > 0 && options.length < rawDataArrayLength
            ? `raw rows (${rawDataArrayLength}) vs parsed (${options.length})`
            : null;

      routes.push({
        city: cityDef.city,
        route: route.label,
        pickupAddress: route.pickup.addressText,
        deliveryAddress: route.drop.addressText,
        pickupPin: pickupPin.postalCode,
        deliveryPin: dropPin.postalCode,
        pickupCoordinates: {
          latitude: pickupGeo.latitude,
          longitude: pickupGeo.longitude,
        },
        deliveryCoordinates: {
          latitude: dropGeo.latitude,
          longitude: dropGeo.longitude,
        },
        forwardGeocodeFormatted: {
          pickup: pickupGeo.formattedAddress,
          drop: dropGeo.formattedAddress,
        },
        httpStatus: httpResponse.status,
        latencyMs,
        shiprocketApiStatus:
          (rawData as Record<string, unknown> | undefined)?.status ?? null,
        shiprocketApiMessage:
          (rawData as Record<string, unknown> | undefined)?.message ?? null,
        parserSuccess: parsed.success,
        parserMalformed: parsed.malformed,
        serviceable: parsed.success && options.length > 0,
        duttAdapterServiceable,
        duttServiceabilityReason,
        optionCount: options.length,
        shiprocketRawDataRowCount: rawDataArrayLength,
        duttAdapterCandidateCount,
        candidatesLostOrCollapsed,
        options,
        sanitizedRawResponse,
        duttAdapterFetchHyperlocalRatesError: adapterError,
      });
    }

    cityResults.push({
      city: cityDef.city,
      routes,
      summary: summarizeCity(cityDef.city, routes as Array<Record<string, unknown>>),
    });
  }

  console.log(
    JSON.stringify(
      {
        packageUsed: PACKAGE,
        schedule: { mode: "ASAP", timezone: "Asia/Kolkata" },
        counters: {
          loginPostBefore: loginBefore,
          loginPostAfter: counters.loginPost,
          serviceabilityGetTotal: counters.serviceabilityGet,
          mutatingRequests: counters.mutating,
        },
        cities: cityResults,
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
