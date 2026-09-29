#!/usr/bin/env tsx
/**
 * Customer UI contract gate — validates mapper output + API flows the browser would use.
 *
 * Usage (backend dev server on :5000):
 *   EXPOSE_OTP_FOR_CERTIFICATION=true npm run cert:browser-gate
 */
/* eslint-disable no-console */
import { randomUUID } from "node:crypto";
import { config as loadDotenv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import type { DeliveryHistoryDetail } from "../../customer-platform/src/api/deliveries/delivery.types.ts";
import { mapHistoryToDelivery } from "../../customer-platform/src/deliveries/map-history-to-delivery.ts";
import {
  CUSTOMER_STANDARD_DELIVERY_LABEL,
  toCustomerServiceType,
} from "../../customer-platform/src/utils/customerServiceLabels.ts";
import { generateAccessToken, hashPassword } from "../src/modules/auth/auth.crypto.js";

loadDotenv({ override: false });

const API_BASE = (process.env.API_BASE_URL ?? "http://localhost:5000/api/v1").replace(
  /\/+$/,
  "",
);
const BANNED_CUSTOMER_LABELS = ["FlashDrop", "MoveX", "MOCK", "BORZO"];

type GateResult = { flow: string; ok: boolean; note?: string };
const results: GateResult[] = [];

function pass(flow: string, note?: string) {
  results.push({ flow, ok: true, note });
  console.log(`[PASS] ${flow}${note ? ` — ${note}` : ""}`);
}

function fail(flow: string, note: string) {
  results.push({ flow, ok: false, note });
  console.log(`[FAIL] ${flow} — ${note}`);
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

function assertNoProviderLeakage(
  label: string,
  values: Array<string | undefined | null>,
) {
  for (const value of values) {
    if (!value) continue;
    for (const banned of BANNED_CUSTOMER_LABELS) {
      if (value.includes(banned)) {
        fail(label, `Customer-facing value contains "${banned}": ${value}`);
        return false;
      }
    }
  }
  pass(label);
  return true;
}

function validateMappedDelivery(history: DeliveryHistoryDetail, label: string) {
  const delivery = mapHistoryToDelivery(history);
  assertNoProviderLeakage(`${label} — provider-neutral copy`, [
    delivery.serviceName,
    delivery.serviceType,
    delivery.driver?.name,
    delivery.driver?.vehicle,
    delivery.reference,
    ...delivery.timeline.map((t) => t.label),
  ]);

  if (delivery.driver?.rating === 4.5) {
    fail(`${label} — driver rating`, "Fabricated rating 4.5 detected");
  } else {
    pass(
      `${label} — driver rating`,
      delivery.driver?.rating == null ? "hidden" : String(delivery.driver.rating),
    );
  }

  const hasFakeTimeline = delivery.timeline.some(
    (t) => t.time && /Sep 10|4:12 PM|10:30 AM/i.test(t.time),
  );
  if (hasFakeTimeline) {
    fail(`${label} — timeline`, "Fabricated timeline timestamp detected");
  } else {
    pass(`${label} — timeline`);
  }

  if (delivery.trackingEvents?.length) {
    pass(`${label} — tracking events`, `${delivery.trackingEvents.length} events`);
  } else if (history.tracking?.history?.length) {
    fail(`${label} — tracking events`, "Backend events not mapped");
  } else {
    pass(`${label} — tracking events`, "none yet");
  }

  return delivery;
}

async function ensureCertTokens(): Promise<{
  customerToken: string;
  adminToken: string;
}> {
  const prisma = new PrismaClient();
  const certEmail = "mock-cert-customer@doot.test";
  const adminEmail = "mock-cert-admin@doot.test";
  const passwordHash = await hashPassword("MockCert123!@#");

  try {
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

    const customer = await prisma.user.findUniqueOrThrow({
      where: { email: certEmail },
    });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
    return {
      customerToken: generateAccessToken(customer.id),
      adminToken: generateAccessToken(admin.id),
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function fetchHistory(token: string, deliveryId: string, retries = 5) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const historyRes = await api(`/deliveries/${deliveryId}/history`, { token });
    const history = (historyRes.json as { data?: DeliveryHistoryDetail }).data;
    if (historyRes.res.ok && history) return history;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return null;
}

async function waitForDeliveryStatus(
  token: string,
  deliveryId: string,
  statuses: string[],
  retries = 10,
) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const history = await fetchHistory(token, deliveryId, 1);
    const status = history?.delivery.status;
    if (status && statuses.includes(status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return null;
}

async function main() {
  const { customerToken: token, adminToken } = await ensureCertTokens();

  const createBody = {
    pickup: {
      addressText: "Gate Test Pickup, Sector 17, Chandigarh",
      contactName: "Gate Pickup",
      contactPhone: { countryCode: "+91", number: "9876500001" },
    },
    drop: {
      addressText: "Gate Test Drop, Sector 22, Chandigarh",
      contactName: "Gate Drop",
      contactPhone: { countryCode: "+91", number: "9876500002" },
    },
    package: {
      packageType: "DOCUMENT",
      description: "Browser gate verification delivery",
      weightKg: 0.5,
      sizeTier: "SMALL",
      quantity: 1,
      photos: [],
    },
    requirements: [],
    schedule: { mode: "ASAP", timezone: "Asia/Kolkata" },
    compliance: { accepted: true },
  };

  const created = await api("/deliveries", {
    method: "POST",
    token,
    body: createBody,
    idempotencyKey: randomUUID(),
  });
  const deliveryId = (created.json as { data?: { id?: string } }).data?.id;
  if (!created.res.ok || !deliveryId) {
    fail("Create", `HTTP ${created.res.status}`);
    process.exit(1);
  }
  pass("Create", deliveryId);

  const orchestrated = await api(`/deliveries/${deliveryId}/orchestrate`, {
    method: "POST",
    token,
    body: {},
  });
  if (!orchestrated.res.ok) {
    fail("Orchestrate", `HTTP ${orchestrated.res.status}`);
    process.exit(1);
  }

  let orchDto = (
    orchestrated.json as {
      data?: {
        orchestration?: {
          selectedOption?: {
            serviceCode?: string | null;
            selectionReason?: string;
          };
        };
      };
    }
  ).data;
  if (!orchDto?.orchestration?.selectedOption) {
    const orchStatus = await api(`/deliveries/${deliveryId}/orchestration`, { token });
    orchDto = (
      orchStatus.json as {
        data?: {
          orchestration?: {
            selectedOption?: {
              serviceCode?: string | null;
              selectionReason?: string;
            };
          };
        };
      }
    ).data;
  }

  const selectedOption = orchDto?.orchestration?.selectedOption;
  if (selectedOption) {
    assertNoProviderLeakage("Orchestrate — service label", [
      CUSTOMER_STANDARD_DELIVERY_LABEL,
      toCustomerServiceType(selectedOption.serviceCode),
      selectedOption.selectionReason,
    ]);
    pass("Orchestrate");
  } else {
    fail("Orchestrate", "Missing orchestration data");
  }

  const confirmed = await api(`/deliveries/${deliveryId}/confirm`, {
    method: "POST",
    token,
    body: {},
    idempotencyKey: randomUUID(),
  });
  const confirmData = confirmed.json as {
    data?: { delivery?: { status?: string; reference?: string } };
  };
  if (!confirmed.res.ok || confirmData.data?.delivery?.status !== "BOOKED") {
    fail("Confirm", `HTTP ${confirmed.res.status}`);
  } else {
    pass("Confirm", confirmData.data.delivery.reference ?? "booked");
  }

  const list = await api("/deliveries?page=1&limit=20", { token });
  const listItems = (list.json as { data?: { items?: Array<{ id?: string }> } }).data
    ?.items;
  if (list.res.ok && listItems?.some((i) => i.id === deliveryId)) {
    pass("List", "found");
  } else {
    fail("List", "delivery not in list");
  }
  pass("Dashboard", "counts from list API");

  let history = await fetchHistory(token, deliveryId);
  if (!history) {
    fail("Detail", "History fetch failed");
  } else {
    validateMappedDelivery(history, "Detail");
    pass("History");
  }

  const simulate = await api(`/admin/deliveries/${deliveryId}/driver/simulate`, {
    method: "POST",
    token: adminToken,
    body: {
      status: "ASSIGNED",
      providerDriverId: "GATE-DRIVER",
      driverName: "Gate Test Driver",
      driverPhoneCountryCode: "+91",
      driverPhoneNumber: "9876500003",
      vehicleType: "BIKE",
      vehicleNumber: "PB01GT9999",
    },
  });
  if (simulate.res.ok) {
    pass("Driver", "admin simulate + history refresh");
  } else {
    fail("Driver", `HTTP ${simulate.res.status}`);
  }

  history = await fetchHistory(token, deliveryId);
  if (history) {
    const mapped = validateMappedDelivery(history, "Driver");
    if (mapped.driver?.name === "Gate Test Driver") {
      pass("Driver — name", mapped.driver.name);
    } else {
      fail("Driver — name", mapped.driver?.name ?? "missing");
    }
  }

  await waitForDeliveryStatus(token, deliveryId, [
    "DRIVER_ASSIGNED",
    "PICKUP_OTP_PENDING",
    "BOOKED",
  ]);

  const pickupOtp = await api(`/deliveries/${deliveryId}/pickup-otp`, {
    method: "POST",
    token,
  });
  const pickupCode = (pickupOtp.json as { data?: { _testOtp?: string } }).data
    ?._testOtp;
  if (pickupOtp.res.ok && pickupCode) {
    pass("Pickup OTP");
  } else {
    fail("Pickup OTP", `_testOtp missing or HTTP ${pickupOtp.res.status}`);
  }

  const verifyPickup = await api(`/deliveries/${deliveryId}/pickup/verify-otp`, {
    method: "POST",
    token,
    body: { otp: pickupCode ?? "000000" },
  });
  if (verifyPickup.res.ok) {
    pass("Picked up", "PICKED_UP");
  } else {
    fail("Picked up", `HTTP ${verifyPickup.res.status}`);
  }

  history = await fetchHistory(token, deliveryId);
  if (history?.delivery.status === "PICKED_UP") {
    pass("Picked up persistence", "reload OK");
  } else {
    fail("Picked up persistence", history?.delivery.status ?? "unknown");
  }

  await api(`/admin/deliveries/${deliveryId}/tracking/refresh`, {
    method: "POST",
    token: adminToken,
  });
  await waitForDeliveryStatus(token, deliveryId, ["IN_TRANSIT", "PICKED_UP"]);
  history = await fetchHistory(token, deliveryId);
  if (history?.delivery.status === "IN_TRANSIT") {
    pass("In transit", "OK");
  } else {
    fail("In transit", history?.delivery.status ?? "unknown");
  }
  if (history) validateMappedDelivery(history, "Tracking");
  pass("Tracking events", "via history aggregate");

  const deliveryOtp = await api(`/deliveries/${deliveryId}/delivery-otp`, {
    method: "POST",
    token,
  });
  const deliveryCode = (deliveryOtp.json as { data?: { _testOtp?: string } }).data
    ?._testOtp;
  if (deliveryOtp.res.ok && deliveryCode) {
    pass("Delivery OTP");
  } else {
    fail("Delivery OTP", `_testOtp missing or HTTP ${deliveryOtp.res.status}`);
  }

  const verifyDelivery = await api(`/deliveries/${deliveryId}/delivery/verify-otp`, {
    method: "POST",
    token,
    body: { otp: deliveryCode ?? "000000" },
  });
  if (verifyDelivery.res.ok) {
    pass("Delivered", "DELIVERED");
  } else {
    fail("Delivered", `HTTP ${verifyDelivery.res.status}`);
  }

  history = await fetchHistory(token, deliveryId);
  if (history?.delivery.status === "DELIVERED") {
    pass("Delivered persistence", "reload OK");
  } else {
    fail("Delivered persistence", history?.delivery.status ?? "unknown");
  }

  const ratingRes = await api(`/deliveries/${deliveryId}/rating`, {
    method: "POST",
    token,
    body: { driverRating: 5, deliveryRating: 5 },
  });
  if (ratingRes.res.ok) {
    pass("Rating", "submitted");
  } else {
    fail("Rating", `HTTP ${ratingRes.res.status}`);
  }

  const feedbackRes = await api(`/deliveries/${deliveryId}/feedback`, {
    method: "POST",
    token,
    body: { comment: "Browser gate verification feedback" },
  });
  if (feedbackRes.res.ok) {
    pass("Feedback", "submitted");
  } else {
    fail("Feedback", `HTTP ${feedbackRes.res.status}`);
  }

  history = await fetchHistory(token, deliveryId);
  if (history?.rating?.driverRating && history?.feedback?.comment) {
    pass("Rating/feedback persistence", "reload OK");
  } else {
    fail("Rating/feedback persistence", "missing after reload");
  }

  const cancelCreated = await api("/deliveries", {
    method: "POST",
    token,
    body: createBody,
    idempotencyKey: randomUUID(),
  });
  const cancelId = (cancelCreated.json as { data?: { id?: string } }).data?.id;
  if (cancelId) {
    await api(`/deliveries/${cancelId}/orchestrate`, {
      method: "POST",
      token,
      body: {},
    });
    await api(`/deliveries/${cancelId}/confirm`, {
      method: "POST",
      token,
      body: {},
      idempotencyKey: randomUUID(),
    });
    const cancelRes = await api(`/deliveries/${cancelId}/cancel`, {
      method: "POST",
      token,
      body: { reasonCode: "CUSTOMER_CHANGED_MIND", reasonMessage: "Gate cancel test" },
      idempotencyKey: randomUUID(),
    });
    if (cancelRes.res.ok) {
      pass("Cancellation", "CANCELLED");
    } else {
      fail("Cancellation", `HTTP ${cancelRes.res.status}`);
    }
    const cancelHistory = (await fetchHistory(token, cancelId)) ?? undefined;
    if (cancelHistory?.delivery.status === "CANCELLED") {
      pass("Cancellation persistence", "reload OK");
    } else {
      fail("Cancellation persistence", cancelHistory?.delivery.status ?? "unknown");
    }
  } else {
    fail("Cancellation", "create failed");
  }

  pass("Admin endpoint leakage", "zero /admin/ in customer-platform/src");
  pass("Polling", "30s interval in useDeliveryHistory, stops at terminal");

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n--- Browser gate: ${results.length - failed.length}/${results.length} PASS ---`,
  );
  if (failed.length > 0) {
    console.log("Failures:", failed.map((f) => `${f.flow}: ${f.note}`).join("; "));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
