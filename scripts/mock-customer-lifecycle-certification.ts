#!/usr/bin/env tsx
/**
 * MOCK customer lifecycle certification — mirrors customer-platform API calls.
 *
 * Usage (backend dev server must be running with ENABLE_MOCK_PROVIDER_ADAPTER=true):
 *   EXPOSE_OTP_FOR_CERTIFICATION=true npx tsx scripts/mock-customer-lifecycle-certification.ts
 *
 * Driver assignment and in-transit tracking use admin simulate/refresh endpoints.
 * The customer frontend must never call /admin/* — those steps are operator-only
 * for dev/certification. MOCK does not auto-progress driver/tracking in production.
 */
/* eslint-disable no-console -- CLI certification output */
import { randomUUID } from "node:crypto";
import { config as loadDotenv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { generateAccessToken, hashPassword } from "../src/modules/auth/auth.crypto.js";

loadDotenv({ override: false });

const API_BASE = (process.env.API_BASE_URL ?? "http://localhost:5000/api/v1").replace(
  /\/+$/,
  "",
);

type StepResult = {
  step: string;
  endpoint: string;
  httpStatus: number;
  backendStatus?: string;
  ok: boolean;
  detail?: string;
};

const results: StepResult[] = [];

function record(
  step: string,
  endpoint: string,
  res: Response,
  body: unknown,
  ok: boolean,
) {
  const data = body as { data?: { status?: string; delivery?: { status?: string } } };
  const backendStatus = data.data?.status ?? data.data?.delivery?.status ?? undefined;
  results.push({
    step,
    endpoint,
    httpStatus: res.status,
    backendStatus,
    ok,
    detail: ok ? undefined : JSON.stringify(body).slice(0, 200),
  });
  const icon = ok ? "PASS" : "FAIL";
  console.log(
    `[${icon}] ${step} — ${endpoint} — HTTP ${res.status}${backendStatus ? ` — ${backendStatus}` : ""}`,
  );
  if (!ok) {
    console.log(`       ${results.at(-1)?.detail}`);
  }
}

async function api(
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    idempotencyKey?: string;
  } = {},
) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = { raw: text };
    }
  }
  return { res, json };
}

async function ensureCertUsers(prisma: PrismaClient) {
  const certEmail = "mock-cert-customer@doot.test";
  const adminEmail = "mock-cert-admin@doot.test";
  const passwordHash = await hashPassword("MockCert123!@#");

  for (const [email, role, name] of [
    [certEmail, "CUSTOMER", "MOCK Cert Customer"],
    [adminEmail, "ADMIN", "MOCK Cert Admin"],
  ] as const) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash, emailVerified: true, status: "ACTIVE", role },
      });
    } else {
      await prisma.user.create({
        data: {
          name,
          email,
          passwordHash,
          emailVerified: true,
          status: "ACTIVE",
          role,
        },
      });
    }
  }

  const customer = await prisma.user.findUniqueOrThrow({ where: { email: certEmail } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
  return {
    customerToken: generateAccessToken(customer.id),
    adminToken: generateAccessToken(admin.id),
    customerId: customer.id,
  };
}

async function main() {
  if (process.env.EXPOSE_OTP_FOR_CERTIFICATION !== "true") {
    console.warn(
      "Warning: EXPOSE_OTP_FOR_CERTIFICATION is not true — OTP steps may fail unless server returns _testOtp.",
    );
  }

  const prisma = new PrismaClient();
  try {
    const { customerToken, adminToken } = await ensureCertUsers(prisma);

    const createBody = {
      pickup: {
        addressText: "Sector 17, Chandigarh, India",
        contactName: "Cert Pickup",
        contactPhone: { countryCode: "+91", number: "9876543210" },
        instructions: null,
      },
      drop: {
        addressText: "Sector 22, Chandigarh, India",
        contactName: "Cert Drop",
        contactPhone: { countryCode: "+91", number: "9876543211" },
      },
      package: {
        packageType: "DOCUMENT",
        description: "MOCK lifecycle certification",
        weightKg: 0.5,
        sizeTier: "SMALL",
        quantity: 1,
        photos: [],
      },
      requirements: [],
      specialInstructions: null,
      schedule: { mode: "ASAP", timezone: "Asia/Kolkata" },
      compliance: { accepted: true },
    };

    // 1. CREATE
    const createKey = randomUUID();
    const created = await api("/deliveries", {
      method: "POST",
      token: customerToken,
      body: createBody,
      idempotencyKey: createKey,
    });
    const deliveryId = (created.json as { data?: { id?: string } }).data?.id;
    record(
      "CREATE",
      "POST /deliveries",
      created.res,
      created.json,
      created.res.ok && Boolean(deliveryId),
    );
    if (!deliveryId) throw new Error("Create delivery failed");

    // 2. ORCHESTRATE
    const orchestrated = await api(`/deliveries/${deliveryId}/orchestrate`, {
      method: "POST",
      token: customerToken,
      body: {},
    });
    const orchData = (orchestrated.json as { data?: { status?: string } }).data;
    record(
      "ORCHESTRATE",
      "POST /deliveries/:id/orchestrate",
      orchestrated.res,
      orchestrated.json,
      orchestrated.res.ok &&
        (orchData?.status === "COMPLETED" || orchData?.status === "OPTION_READY"),
    );

    // 3. ORCHESTRATION STATUS
    const orchStatus = await api(`/deliveries/${deliveryId}/orchestration`, {
      token: customerToken,
    });
    const selectedOption = (
      orchStatus.json as {
        data?: { orchestration?: { selectedOption?: { providerCode?: string } } };
      }
    ).data?.orchestration?.selectedOption;
    record(
      "OPTION_READY",
      "GET /deliveries/:id/orchestration",
      orchStatus.res,
      orchStatus.json,
      orchStatus.res.ok && selectedOption?.providerCode === "MOCK",
    );

    // 4. CONFIRM
    const confirmed = await api(`/deliveries/${deliveryId}/confirm`, {
      method: "POST",
      token: customerToken,
      body: {},
      idempotencyKey: randomUUID(),
    });
    const bookedStatus = (
      confirmed.json as { data?: { delivery?: { status?: string } } }
    ).data?.delivery?.status;
    record(
      "CONFIRM → BOOKED",
      "POST /deliveries/:id/confirm",
      confirmed.res,
      confirmed.json,
      confirmed.res.ok && bookedStatus === "BOOKED",
    );

    // 5. BOOKING
    const booking = await api(`/deliveries/${deliveryId}/booking`, {
      token: customerToken,
    });
    record(
      "BOOKING",
      "GET /deliveries/:id/booking",
      booking.res,
      booking.json,
      booking.res.ok,
    );

    // 6. ADMIN — driver simulate
    const simulate = await api(`/admin/deliveries/${deliveryId}/driver/simulate`, {
      method: "POST",
      token: adminToken,
      body: {
        status: "ASSIGNED",
        providerDriverId: "MOCK-CERT-DRIVER",
        driverName: "Aman Singh",
        driverPhoneCountryCode: "+91",
        driverPhoneNumber: "9876543210",
        providerRating: 4.8,
        vehicleType: "BIKE",
        vehicleNumber: "PB10AB1234",
      },
    });
    record(
      "DRIVER_ASSIGNED (admin simulate)",
      "POST /admin/deliveries/:id/driver/simulate",
      simulate.res,
      simulate.json,
      simulate.res.ok,
    );

    // 7. DRIVER (customer)
    const driver = await api(`/deliveries/${deliveryId}/driver`, {
      token: customerToken,
    });
    const driverKnown = (driver.json as { data?: { known?: boolean } }).data?.known;
    record(
      "DRIVER",
      "GET /deliveries/:id/driver",
      driver.res,
      driver.json,
      driver.res.ok && driverKnown === true,
    );

    // 8. PICKUP OTP
    const pickupOtp = await api(`/deliveries/${deliveryId}/pickup-otp`, {
      method: "POST",
      token: customerToken,
    });
    const pickupCode = (pickupOtp.json as { data?: { _testOtp?: string } }).data
      ?._testOtp;
    record(
      "PICKUP OTP request",
      "POST /deliveries/:id/pickup-otp",
      pickupOtp.res,
      pickupOtp.json,
      pickupOtp.res.ok && Boolean(pickupCode),
    );

    // 9. VERIFY PICKUP OTP
    const verifyPickup = await api(`/deliveries/${deliveryId}/pickup/verify-otp`, {
      method: "POST",
      token: customerToken,
      body: { otp: pickupCode ?? "000000" },
    });
    const pickedUpStatus = (verifyPickup.json as { data?: { status?: string } }).data
      ?.status;
    record(
      "PICKED_UP",
      "POST /deliveries/:id/pickup/verify-otp",
      verifyPickup.res,
      verifyPickup.json,
      verifyPickup.res.ok && pickedUpStatus === "PICKED_UP",
    );

    // 10. ADMIN — tracking refresh → IN_TRANSIT
    const trackingRefresh = await api(
      `/admin/deliveries/${deliveryId}/tracking/refresh`,
      { method: "POST", token: adminToken },
    );
    record(
      "IN_TRANSIT (admin tracking refresh)",
      "POST /admin/deliveries/:id/tracking/refresh",
      trackingRefresh.res,
      trackingRefresh.json,
      trackingRefresh.res.ok,
    );

    // 11. TRACKING
    const tracking = await api(`/deliveries/${deliveryId}/tracking`, {
      token: customerToken,
    });
    record(
      "TRACKING",
      "GET /deliveries/:id/tracking",
      tracking.res,
      tracking.json,
      tracking.res.ok,
    );

    // 12. DELIVERY OTP
    const deliveryOtp = await api(`/deliveries/${deliveryId}/delivery-otp`, {
      method: "POST",
      token: customerToken,
    });
    const deliveryCode = (deliveryOtp.json as { data?: { _testOtp?: string } }).data
      ?._testOtp;
    record(
      "DELIVERY OTP request",
      "POST /deliveries/:id/delivery-otp",
      deliveryOtp.res,
      deliveryOtp.json,
      deliveryOtp.res.ok && Boolean(deliveryCode),
    );

    // 13. VERIFY DELIVERY OTP → DELIVERED
    const verifyDelivery = await api(`/deliveries/${deliveryId}/delivery/verify-otp`, {
      method: "POST",
      token: customerToken,
      body: { otp: deliveryCode ?? "000000" },
    });
    const deliveredStatus = (verifyDelivery.json as { data?: { status?: string } }).data
      ?.status;
    record(
      "DELIVERED",
      "POST /deliveries/:id/delivery/verify-otp",
      verifyDelivery.res,
      verifyDelivery.json,
      verifyDelivery.res.ok && deliveredStatus === "DELIVERED",
    );

    // 14. RATING
    const rating = await api(`/deliveries/${deliveryId}/rating`, {
      method: "POST",
      token: customerToken,
      body: { driverRating: 5, deliveryRating: 5 },
    });
    record(
      "RATING",
      "POST /deliveries/:id/rating",
      rating.res,
      rating.json,
      rating.res.ok,
    );

    // 15. FEEDBACK
    const feedback = await api(`/deliveries/${deliveryId}/feedback`, {
      method: "POST",
      token: customerToken,
      body: { comment: "MOCK lifecycle certification — smooth delivery." },
    });
    record(
      "FEEDBACK",
      "POST /deliveries/:id/feedback",
      feedback.res,
      feedback.json,
      feedback.res.ok,
    );

    // 16. HISTORY
    const history = await api(`/deliveries/${deliveryId}/history`, {
      token: customerToken,
    });
    const historyStatus = (
      history.json as { data?: { delivery?: { status?: string } } }
    ).data?.delivery?.status;
    record(
      "HISTORY",
      "GET /deliveries/:id/history",
      history.res,
      history.json,
      history.res.ok && historyStatus === "DELIVERED",
    );

    // 17. LIST
    const list = await api("/deliveries?page=1&limit=10", { token: customerToken });
    record("LIST", "GET /deliveries", list.res, list.json, list.res.ok);

    const coreCount = results.length;

    // --- Cancellation lifecycle (separate fresh delivery) ---
    const cancelCreateKey = randomUUID();
    const cancelCreated = await api("/deliveries", {
      method: "POST",
      token: customerToken,
      body: {
        ...createBody,
        package: {
          ...createBody.package,
          description: "MOCK cancellation certification",
        },
      },
      idempotencyKey: cancelCreateKey,
    });
    const cancelDeliveryId = (cancelCreated.json as { data?: { id?: string } }).data
      ?.id;
    record(
      "CANCEL CREATE",
      "POST /deliveries",
      cancelCreated.res,
      cancelCreated.json,
      cancelCreated.res.ok && Boolean(cancelDeliveryId),
    );
    if (!cancelDeliveryId) throw new Error("Cancel lifecycle create failed");

    const cancelOrchestrated = await api(
      `/deliveries/${cancelDeliveryId}/orchestrate`,
      {
        method: "POST",
        token: customerToken,
        body: {},
      },
    );
    record(
      "CANCEL ORCHESTRATE",
      "POST /deliveries/:id/orchestrate",
      cancelOrchestrated.res,
      cancelOrchestrated.json,
      cancelOrchestrated.res.ok,
    );

    const cancelConfirmed = await api(`/deliveries/${cancelDeliveryId}/confirm`, {
      method: "POST",
      token: customerToken,
      body: {},
      idempotencyKey: randomUUID(),
    });
    const cancelBookedStatus = (
      cancelConfirmed.json as { data?: { delivery?: { status?: string } } }
    ).data?.delivery?.status;
    record(
      "CANCEL CONFIRM → BOOKED",
      "POST /deliveries/:id/confirm",
      cancelConfirmed.res,
      cancelConfirmed.json,
      cancelConfirmed.res.ok && cancelBookedStatus === "BOOKED",
    );

    const cancelResponse = await api(`/deliveries/${cancelDeliveryId}/cancel`, {
      method: "POST",
      token: customerToken,
      body: {
        reasonCode: "CUSTOMER_CHANGED_MIND",
        reasonMessage: "MOCK cancellation certification",
      },
      idempotencyKey: randomUUID(),
    });
    const cancelResultStatus = (
      cancelResponse.json as { data?: { delivery?: { status?: string } } }
    ).data?.delivery?.status;
    record(
      "CANCELLED",
      "POST /deliveries/:id/cancel",
      cancelResponse.res,
      cancelResponse.json,
      cancelResponse.res.ok && cancelResultStatus === "CANCELLED",
    );

    const cancelHistory = await api(`/deliveries/${cancelDeliveryId}/history`, {
      token: customerToken,
    });
    const cancelHistoryData = (
      cancelHistory.json as {
        data?: {
          delivery?: { status?: string };
          cancellation?: {
            reasonCode?: string;
            reasonMessage?: string | null;
            cancelledAt?: string | null;
          };
        };
      }
    ).data;
    record(
      "CANCEL HISTORY",
      "GET /deliveries/:id/history",
      cancelHistory.res,
      cancelHistory.json,
      cancelHistory.res.ok &&
        cancelHistoryData?.delivery?.status === "CANCELLED" &&
        cancelHistoryData?.cancellation?.reasonCode === "CUSTOMER_CHANGED_MIND" &&
        Boolean(cancelHistoryData?.cancellation?.cancelledAt),
    );

    const cancelList = await api("/deliveries?page=1&limit=50", {
      token: customerToken,
    });
    const cancelListItems = (
      cancelList.json as { data?: { items?: Array<{ id?: string; status?: string }> } }
    ).data?.items;
    const cancelInList = cancelListItems?.find(
      (item) => item.id === cancelDeliveryId && item.status === "CANCELLED",
    );
    record(
      "CANCEL LIST",
      "GET /deliveries",
      cancelList.res,
      cancelList.json,
      cancelList.res.ok && Boolean(cancelInList),
    );

    const failed = results.filter((r) => !r.ok);
    const coreResults = results.slice(0, coreCount);
    const cancelResults = results.slice(coreCount);
    const coreFailed = coreResults.filter((r) => !r.ok);
    const cancelFailed = cancelResults.filter((r) => !r.ok);

    console.log("\n--- Summary ---");
    console.log(
      `Core lifecycle: ${coreResults.length - coreFailed.length}/${coreResults.length} PASS`,
    );
    console.log(
      `Cancellation lifecycle: ${cancelResults.length - cancelFailed.length}/${cancelResults.length} PASS`,
    );
    console.log(`Total steps: ${results.length}`);
    console.log(`Passed: ${results.length - failed.length}`);
    console.log(`Failed: ${failed.length}`);
    console.log(`Delivery ID (core): ${deliveryId}`);
    console.log(`Delivery ID (cancel): ${cancelDeliveryId}`);

    if (failed.length > 0) {
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
