/**
 * Ephemeral runtime verification — not for production. Delete after use.
 * Requires DATABASE_URL/DIRECT_URL set to local dev DB before run.
 *
 * Auth-only by default. Optional read-only diagnostics:
 *   SHIPROCKET_RUNTIME_VERIFY_STAGE_B=1 — hyperlocal serviceability GET
 *   SHIPROCKET_RUNTIME_VERIFY_PROBE_QUOTE=1 — adapter probeQuote (same GET, admin path)
 */
const AUTH_PATH_SUFFIX = "/v1/external/auth/login";

type Counters = {
  loginRequests: number;
  serviceabilityRequests: number;
  mutatingRequests: number;
};

const MUTATING_PATH_FRAGMENTS = [
  "/orders/create",
  "/assign/awb",
  "/orders/cancel",
  "/pickup/",
  "/manifest",
] as const;

function isLoginRequest(url: string, method: string): boolean {
  return method.toUpperCase() === "POST" && url.includes(AUTH_PATH_SUFFIX);
}

function isServiceabilityRequest(url: string, method: string): boolean {
  return method.toUpperCase() === "GET" && url.includes("/courier/serviceability");
}

function isMutatingShiprocketRequest(url: string, method: string): boolean {
  const upper = method.toUpperCase();
  if (upper === "GET" || upper === "HEAD") {
    return false;
  }
  return MUTATING_PATH_FRAGMENTS.some((fragment) => url.includes(fragment));
}

function createCountingFetch(counters: Counters): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const method = init?.method ?? "GET";
    if (isLoginRequest(url, method)) {
      counters.loginRequests += 1;
    }
    if (isServiceabilityRequest(url, method)) {
      counters.serviceabilityRequests += 1;
    }
    if (isMutatingShiprocketRequest(url, method)) {
      counters.mutatingRequests += 1;
    }
    return fetch(input, init);
  };
}

async function ensureShiprocketProvider(
  prisma: import("@prisma/client").PrismaClient,
): Promise<string> {
  const existing = await prisma.provider.findUnique({ where: { code: "SHIPROCKET" } });
  if (existing) {
    return existing.id;
  }
  const created = await prisma.provider.create({
    data: {
      code: "SHIPROCKET",
      name: "Shiprocket",
      environment: "LIVE",
      enabled: true,
      orchestrationEnabled: true,
      status: "ACTIVE",
      integrationStatus: "CONFIGURED",
      settings: { create: {} },
      capabilities: {
        create: [{ capability: "SERVICEABILITY" }, { capability: "PRICING" }],
      },
    },
  });
  return created.id;
}

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || !dbUrl.includes("127.0.0.1:5433")) {
    throw new Error(
      "Refusing to run: DATABASE_URL must point at local disposable Postgres.",
    );
  }

  const stageB = process.env.SHIPROCKET_RUNTIME_VERIFY_STAGE_B === "1";
  const probeQuote = process.env.SHIPROCKET_RUNTIME_VERIFY_PROBE_QUOTE === "1";

  const { PrismaClient } = await import("@prisma/client");
  const { disconnectDatabase } = await import("../src/config/database.js");
  await disconnectDatabase();
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const providerId = await ensureShiprocketProvider(prisma);

  const { ProviderConfigResolver } =
    await import("../src/modules/provider/adapters/provider-config-resolver.js");
  const { ShiprocketAuthService } =
    await import("../src/modules/provider/adapters/shiprocket/shiprocket-auth.service.js");
  const { ProviderHttpClient } =
    await import("../src/modules/provider/adapters/provider-http-client.js");

  const resolver = new ProviderConfigResolver();
  const config = await resolver.resolveById(providerId);
  const counters: Counters = {
    loginRequests: 0,
    serviceabilityRequests: 0,
    mutatingRequests: 0,
  };
  const http = new ProviderHttpClient(createCountingFetch(counters));
  const auth = new ShiprocketAuthService(http);
  auth.clearCacheForTests();

  const requestId = "runtime-verify-1";
  await auth.getBearerToken({ config, requestId: `${requestId}-first` });
  const rowAfterFirst = await prisma.providerAuthToken.findUnique({
    where: { providerId },
  });
  if (!rowAfterFirst) {
    throw new Error("ProviderAuthToken row missing after first auth");
  }
  if (!rowAfterFirst.tokenIv || !rowAfterFirst.tokenAuthTag) {
    throw new Error("Missing encryption IV or auth tag");
  }
  const loginAfterFirst = counters.loginRequests;

  auth.clearCacheForTests();
  await auth.getBearerToken({ config, requestId: `${requestId}-second` });
  const loginAfterSecond = counters.loginRequests;

  const authRestart = new ShiprocketAuthService(
    new ProviderHttpClient(createCountingFetch(counters)),
  );
  authRestart.clearCacheForTests();
  await authRestart.getBearerToken({ config, requestId: `${requestId}-restart` });
  const loginAfterRestart = counters.loginRequests;

  let stageBResult: Record<string, unknown> | null = null;
  let probeQuoteResult: Record<string, unknown> | null = null;

  if (stageB) {
    const { ShiprocketHyperlocalServiceabilityService } =
      await import("../src/modules/provider/adapters/shiprocket/shiprocket-hyperlocal.serviceability.js");
    const hyperlocal = new ShiprocketHyperlocalServiceabilityService(
      new ProviderHttpClient(createCountingFetch(counters)),
      authRestart,
    );
    const stageBStarted = Date.now();
    try {
      const hl = await hyperlocal.fetchRates(
        {
          deliveryId: "00000000-0000-0000-0000-000000000001",
          deliveryReference: "runtime-stage-b",
          pickup: {
            addressText: "Connaught Place, New Delhi 110001",
            contactName: "Runtime Test Pickup",
            contactPhoneCountryCode: "+91",
            contactPhoneNumber: "9999999999",
            latitude: 28.6139,
            longitude: 77.209,
          },
          drop: {
            addressText: "Noida Sector 18, 110020 area",
            contactName: "Runtime Test Drop",
            contactPhoneCountryCode: "+91",
            contactPhoneNumber: "9999999998",
            latitude: 28.5355,
            longitude: 77.391,
          },
          package: {
            packageType: "PARCEL",
            weightKg: 0.5,
            lengthCm: 10,
            widthCm: 10,
            heightCm: 10,
            quantity: 1,
          },
          schedule: { mode: "ASAP", timezone: "Asia/Kolkata" },
          requirements: [],
          specialInstructions: null,
        },
        { requestId: "runtime-stage-b-svc", config },
      );
      stageBResult = {
        httpStatusApprox: 200,
        latencyMs: Date.now() - stageBStarted,
        serviceable: hl.serviceability.serviceable,
        quoteAvailable: hl.candidates[0]?.quote.available ?? false,
        quoteAmountInr: hl.candidates[0]?.quote.amount?.amount ?? null,
      };
    } catch (error) {
      stageBResult = {
        httpStatusApprox: 0,
        latencyMs: Date.now() - stageBStarted,
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      };
    }
  }

  if (probeQuote) {
    const { ShiprocketProviderAdapter } =
      await import("../src/modules/provider/adapters/shiprocket/shiprocket-provider.adapter.js");
    const { ShiprocketHyperlocalServiceabilityService } =
      await import("../src/modules/provider/adapters/shiprocket/shiprocket-hyperlocal.serviceability.js");
    const probeHttp = new ProviderHttpClient(createCountingFetch(counters));
    const probeAuth = new ShiprocketAuthService(probeHttp);
    probeAuth.clearCacheForTests();
    const adapter = new ShiprocketProviderAdapter(
      new ShiprocketHyperlocalServiceabilityService(probeHttp, probeAuth),
      probeAuth,
    );
    const probeStarted = Date.now();
    try {
      const probe = await adapter.probeQuote(
        {
          pickup: {
            addressText: "Connaught Place, New Delhi 110001",
            contactName: "Runtime Test Pickup",
            contactPhoneCountryCode: "+91",
            contactPhoneNumber: "9999999999",
            latitude: 28.6139,
            longitude: 77.209,
          },
          drop: {
            addressText: "Noida Sector 18, 110020 area",
            contactName: "Runtime Test Drop",
            contactPhoneCountryCode: "+91",
            contactPhoneNumber: "9999999998",
            latitude: 28.5355,
            longitude: 77.391,
          },
          package: {
            packageType: "PARCEL",
            weightKg: 0.5,
            lengthCm: 10,
            widthCm: 10,
            heightCm: 10,
            quantity: 1,
          },
          schedule: { mode: "ASAP", timezone: "Asia/Kolkata" },
          requirements: [],
          specialInstructions: null,
        },
        { requestId: "runtime-probe-quote", config },
      );
      probeQuoteResult = {
        latencyMs: Date.now() - probeStarted,
        serviceable: probe.serviceability.serviceable,
        quoteAvailable: probe.quote.available,
        quoteAmountInr: probe.quote.amount?.amount ?? null,
      };
    } catch (error) {
      probeQuoteResult = {
        latencyMs: Date.now() - probeStarted,
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      };
    }
  }

  console.log(
    JSON.stringify({
      providerId,
      auth: {
        loginAfterFirst,
        loginAfterSecond,
        loginAfterRestart,
        tokenRow: {
          hasCiphertext: Boolean(rowAfterFirst.tokenCiphertext),
          expiresAt: rowAfterFirst.expiresAt.toISOString(),
          issuedAt: rowAfterFirst.issuedAt.toISOString(),
          refreshedAt: rowAfterFirst.refreshedAt?.toISOString() ?? null,
          ciphertextLength: rowAfterFirst.tokenCiphertext.length,
        },
      },
      counters: {
        loginRequests: counters.loginRequests,
        serviceabilityGetRequests: counters.serviceabilityRequests,
        mutatingRequests: counters.mutatingRequests,
      },
      stageB: stageBResult,
      probeQuote: probeQuoteResult,
    }),
  );

  await prisma.$disconnect();
  await disconnectDatabase();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
