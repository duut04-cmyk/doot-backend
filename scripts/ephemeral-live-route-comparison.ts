/**
 * Ephemeral LIVE read-only: Delhi/Noida vs Karnal (one route each). Local DB only.
 */

const PACKAGE = {
  packageType: "PARCEL" as const,
  weightKg: 0.5,
  lengthCm: 10,
  widthCm: 10,
  heightCm: 10,
  quantity: 1,
};

type RouteDef = {
  label: string;
  pickup: { lat: number; lng: number; addressText: string };
  drop: { lat: number; lng: number; addressText: string };
};

const ROUTES: RouteDef[] = [
  {
    label: "delhi-noida",
    pickup: {
      lat: 28.6139,
      lng: 77.209,
      addressText: "Connaught Place, New Delhi 110001",
    },
    drop: {
      lat: 28.5355,
      lng: 77.391,
      addressText: "Noida Sector 18 area",
    },
  },
  {
    label: "karnal-p1-d1",
    pickup: {
      lat: 29.693438,
      lng: 76.985044,
      addressText: "SCO 78, Mahila Ashram, Karnal 132001",
    },
    drop: {
      lat: 29.701415,
      lng: 76.984767,
      addressText: "NDRI, Karnal 132001",
    },
  },
];

function sanitizeEntry(entry: unknown): Record<string, unknown> {
  if (!entry || typeof entry !== "object") {
    return {};
  }
  const row = entry as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of [
    "courier_name",
    "courier_company_id",
    "rate_id",
    "rates",
    "rate",
    "eta",
    "etd",
  ]) {
    if (key in row) {
      out[key] = row[key];
    }
  }
  return out;
}

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl?.includes("127.0.0.1:5433")) {
    throw new Error("DATABASE_URL must be local 127.0.0.1:5433");
  }

  const { disconnectDatabase } = await import("../src/config/database.js");
  await disconnectDatabase();
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const provider = await prisma.provider.findUnique({ where: { code: "SHIPROCKET" } });
  if (!provider) {
    throw new Error("SHIPROCKET provider missing");
  }

  const { ProviderConfigResolver } =
    await import("../src/modules/provider/adapters/provider-config-resolver.js");
  const { ShiprocketProviderAdapter } =
    await import("../src/modules/provider/adapters/shiprocket/shiprocket-provider.adapter.js");
  const config = await new ProviderConfigResolver().resolveById(provider.id);
  const adapter = new ShiprocketProviderAdapter();

  const results = [];
  for (const route of ROUTES) {
    const started = Date.now();
    const fetchResult = await adapter.fetchHyperlocalRates(
      {
        deliveryReference: `live-compare-${route.label}`,
        pickup: {
          addressText: route.pickup.addressText,
          contactName: "Test",
          contactPhoneCountryCode: "+91",
          contactPhoneNumber: "9999999991",
          instructions: null,
          latitude: route.pickup.lat,
          longitude: route.pickup.lng,
        },
        drop: {
          addressText: route.drop.addressText,
          contactName: "Test",
          contactPhoneCountryCode: "+91",
          contactPhoneNumber: "9999999992",
          instructions: null,
          latitude: route.drop.lat,
          longitude: route.drop.lng,
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
      { requestId: `live-${route.label}`, config },
    );
    const rawArray = fetchResult.providerMetadata
      .shiprocketHyperlocalRates as unknown[];

    results.push({
      route: route.label,
      httpStatusApprox: 200,
      latencyMs: Date.now() - started,
      pickupPin: fetchResult.providerMetadata.shiprocketPickupPostcode,
      deliveryPin: fetchResult.providerMetadata.shiprocketDeliveryPostcode,
      duttServiceable: fetchResult.serviceability.serviceable,
      duttServiceabilityReason: fetchResult.serviceability.reason,
      candidateCount: fetchResult.candidates.length,
      options: fetchResult.candidates.map((c, i) => ({
        courierName: c.providerMetadata.shiprocketCourierName,
        courierCompanyId: (rawArray[i] as Record<string, unknown> | undefined)
          ?.courier_company_id,
        providerQuoteId: c.quote.providerQuoteId,
        priceInr: c.quote.amount?.amount,
        etaMinutes: c.quote.estimatedDeliveryMinutes,
        sanitizedRaw: sanitizeEntry(rawArray[i]),
      })),
      sanitizedRawResponse: {
        serviceable: fetchResult.serviceability.serviceable,
        rawEntryCount: rawArray.length,
        entries: rawArray.map(sanitizeEntry),
      },
    });
  }

  console.log(JSON.stringify({ packageUsed: PACKAGE, routes: results }, null, 2));
  await prisma.$disconnect();
  await disconnectDatabase();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
