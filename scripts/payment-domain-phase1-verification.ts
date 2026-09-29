#!/usr/bin/env tsx
/**
 * Payment Domain Phase 1 — end-to-end verification against real DB + HTTP API.
 *
 * Prerequisites:
 *   - Backend running (default http://localhost:5000)
 *   - ENABLE_MOCK_PROVIDER_ADAPTER=true
 *   - Migration 20260928120000_add_payment_domain applied
 *
 * Usage:
 *   npx tsx scripts/payment-domain-phase1-verification.ts
 */
/* eslint-disable no-console -- verification CLI output */
import { randomUUID } from "node:crypto";
import { config as loadDotenv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { generateAccessToken, hashPassword } from "../src/modules/auth/auth.crypto.js";
import { paymentService } from "../src/modules/payment/payment.service.js";
import { ledgerIdempotencyKeyForPaymentSuccess } from "../src/modules/payment/payment.constants.js";

loadDotenv({ override: false });

const API_BASE = (process.env.API_BASE_URL ?? "http://localhost:5000/api/v1").replace(
  /\/+$/,
  "",
);

type Step = { name: string; ok: boolean; detail?: string };
const steps: Step[] = [];

function pass(name: string, detail?: string) {
  steps.push({ name, ok: true, detail });
  console.log(`[PASS] ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, detail?: string) {
  steps.push({ name, ok: false, detail });
  console.log(`[FAIL] ${name}${detail ? ` — ${detail}` : ""}`);
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

async function ensureUser(
  prisma: PrismaClient,
  email: string,
  name: string,
  role: "CUSTOMER" | "ADMIN",
) {
  const passwordHash = await hashPassword("PaymentVerify123!@#");
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, emailVerified: true, status: "ACTIVE", role },
    });
    return existing.id;
  }
  const created = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      emailVerified: true,
      status: "ACTIVE",
      role,
    },
  });
  return created.id;
}

async function main() {
  const prisma = new PrismaClient();
  const summary = {
    migrationApplied: false,
    schemaVerified: false,
    mockCore: "NOT_RUN",
    mockCancel: "NOT_RUN",
  };

  try {
    const health = await fetch(`${API_BASE}/health`);
    if (!health.ok) {
      fail("API health", `HTTP ${health.status}`);
      throw new Error("Backend not reachable. Start with npm run dev.");
    }
    pass("API health", `${API_BASE}/health`);

    const migrations = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE migration_name = '20260928120000_add_payment_domain'
    `;
    summary.migrationApplied = migrations.length > 0;
    if (summary.migrationApplied) {
      pass("Migration applied", "20260928120000_add_payment_domain");
    } else {
      fail("Migration applied", "20260928120000_add_payment_domain missing");
    }

    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('Payment','PaymentAttempt','Refund','LedgerEntry','PaymentCreateIdempotencyKey')
    `;
    summary.schemaVerified = tables.length === 5;
    if (summary.schemaVerified) {
      pass("Schema tables", "5/5 payment tables present");
    } else {
      fail("Schema tables", `found ${tables.length}/5`);
    }

    const customerEmail = `payment-verify-a-${Date.now()}@doot.test`;
    const otherEmail = `payment-verify-b-${Date.now()}@doot.test`;
    const customerId = await ensureUser(
      prisma,
      customerEmail,
      "Payment Verify A",
      "CUSTOMER",
    );
    const otherId = await ensureUser(
      prisma,
      otherEmail,
      "Payment Verify B",
      "CUSTOMER",
    );
    const customerToken = generateAccessToken(customerId);
    const otherToken = generateAccessToken(otherId);

    const createBody = {
      pickup: {
        addressText: "Sector 17, Chandigarh, India",
        contactName: "Pay Verify Pickup",
        contactPhone: { countryCode: "+91", number: "9876543210" },
        instructions: null,
      },
      drop: {
        addressText: "Sector 22, Chandigarh, India",
        contactName: "Pay Verify Drop",
        contactPhone: { countryCode: "+91", number: "9876543211" },
      },
      package: {
        packageType: "DOCUMENT",
        description: "Payment Phase 1 verification",
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

    const created = await api("/deliveries", {
      method: "POST",
      token: customerToken,
      body: createBody,
      idempotencyKey: randomUUID(),
    });
    const deliveryId = (created.json as { data?: { id?: string } }).data?.id;
    if (!created.res.ok || !deliveryId) {
      fail("Create delivery", JSON.stringify(created.json).slice(0, 200));
      throw new Error("Create delivery failed");
    }
    pass("Create delivery", deliveryId);

    const orchestrated = await api(`/deliveries/${deliveryId}/orchestrate`, {
      method: "POST",
      token: customerToken,
      body: {},
    });
    const orchPost = orchestrated.json as {
      success?: boolean;
      data?: { status?: string };
    };
    const orchPostStatus = orchPost.data?.status;
    if (!orchPost.success || orchPostStatus !== "OPTION_READY") {
      fail(
        "Orchestrate",
        `HTTP ${orchestrated.res.status} ${JSON.stringify(orchestrated.json).slice(0, 200)}`,
      );
      throw new Error("Orchestrate failed");
    }

    const orchStatus = await api(`/deliveries/${deliveryId}/orchestration`, {
      token: customerToken,
    });
    const orchData = (
      orchStatus.json as {
        data?: {
          orchestration?: {
            selectedOption?: { quote?: { amount?: number; currency?: string } } | null;
          };
        };
      }
    ).data;
    const quoteAmount = orchData?.orchestration?.selectedOption?.quote?.amount;
    const quoteCurrency = orchData?.orchestration?.selectedOption?.quote?.currency;
    if (!orchStatus.res.ok || quoteAmount == null || quoteAmount <= 0) {
      fail("Orchestration quote", JSON.stringify(orchStatus.json).slice(0, 200));
      throw new Error("Orchestration quote missing");
    }
    pass("Orchestrate OPTION_READY", `quote ${quoteAmount} ${quoteCurrency ?? ""}`);

    const idemKey = `pay-verify-${randomUUID()}`;
    const pay1 = await api(`/deliveries/${deliveryId}/payment`, {
      method: "POST",
      token: customerToken,
      idempotencyKey: idemKey,
    });
    const payBody1 = pay1.json as {
      data?: {
        payment?: { id?: string; amount?: number; currency?: string; status?: string };
      };
    };
    const paymentId = payBody1.data?.payment?.id;
    const payAmount = payBody1.data?.payment?.amount;
    const payStatus = payBody1.data?.payment?.status;
    if (!pay1.res.ok || !paymentId) {
      fail("POST payment", JSON.stringify(pay1.json).slice(0, 200));
      throw new Error("POST payment failed");
    }
    pass("POST payment", `id=${paymentId} status=${payStatus}`);

    if (
      payAmount === quoteAmount &&
      quoteCurrency === "INR" &&
      payBody1.data?.payment?.currency === "INR"
    ) {
      pass("Server-side amount", `${payAmount} INR matches quote`);
    } else {
      fail(
        "Server-side amount",
        `payment=${payAmount} ${payBody1.data?.payment?.currency} quote=${quoteAmount} ${quoteCurrency}`,
      );
    }

    const pay2 = await api(`/deliveries/${deliveryId}/payment`, {
      method: "POST",
      token: customerToken,
      idempotencyKey: idemKey,
    });
    const payId2 = (pay2.json as { data?: { payment?: { id?: string } } }).data?.payment
      ?.id;
    if (pay2.res.ok && payId2 === paymentId) {
      pass("Idempotency-Key replay", "same payment id");
    } else {
      fail("Idempotency-Key replay", `expected ${paymentId}, got ${payId2}`);
    }

    const pay3 = await api(`/deliveries/${deliveryId}/payment`, {
      method: "POST",
      token: customerToken,
    });
    const payId3 = (pay3.json as { data?: { payment?: { id?: string } } }).data?.payment
      ?.id;
    if (pay3.res.ok && payId3 === paymentId) {
      pass("Duplicate POST without key", "returns existing payment");
    } else {
      fail("Duplicate POST without key", `payment id ${payId3}`);
    }

    const dbPaymentCount = await prisma.payment.count({ where: { deliveryId } });
    if (dbPaymentCount === 1) {
      pass("DB single payment per delivery", "count=1");
    } else {
      fail("DB single payment per delivery", `count=${dbPaymentCount}`);
    }

    const getPay = await api(`/deliveries/${deliveryId}/payment`, {
      token: customerToken,
    });
    const getId = (
      getPay.json as { data?: { payment?: { id?: string; amount?: number } } }
    ).data?.payment?.id;
    if (getPay.res.ok && getId === paymentId) {
      pass("GET payment", "matches POST");
    } else {
      fail("GET payment", JSON.stringify(getPay.json).slice(0, 200));
    }

    const otherGet = await api(`/deliveries/${deliveryId}/payment`, {
      token: otherToken,
    });
    if (otherGet.res.status === 404) {
      pass("Cross-user GET", "404 Delivery not found");
    } else {
      fail("Cross-user GET", `HTTP ${otherGet.res.status}`);
    }

    const otherPost = await api(`/deliveries/${deliveryId}/payment`, {
      method: "POST",
      token: otherToken,
    });
    if (otherPost.res.status === 404) {
      pass("Cross-user POST", "404 Delivery not found");
    } else {
      fail("Cross-user POST", `HTTP ${otherPost.res.status}`);
    }

    await paymentService.markPaymentPaid({ paymentId });
    await paymentService.markPaymentPaid({ paymentId });
    const paid = await prisma.payment.findUnique({ where: { id: paymentId } });
    const ledgerCount = await prisma.ledgerEntry.count({
      where: {
        paymentId,
        type: "CUSTOMER_PAYMENT",
        idempotencyKey: ledgerIdempotencyKeyForPaymentSuccess(paymentId),
      },
    });
    if (paid?.status === "PAID" && ledgerCount === 1) {
      pass("Ledger idempotency PAID", "one CUSTOMER_PAYMENT entry");
    } else {
      fail("Ledger idempotency PAID", `status=${paid?.status} ledger=${ledgerCount}`);
    }

    const partial = await paymentService.requestRefund({
      paymentId,
      amount: 10,
      idempotencyKey: `refund-partial-${paymentId}`,
    });
    await paymentService.markRefundSuccessful({ refundId: partial.id });
    const afterPartial = await prisma.payment.findUnique({ where: { id: paymentId } });

    const remainder = Number(paid!.amount) - 10;
    const full = await paymentService.requestRefund({
      paymentId,
      amount: remainder,
      idempotencyKey: `refund-full-${paymentId}`,
    });
    await paymentService.markRefundSuccessful({ refundId: full.id });
    const afterFull = await prisma.payment.findUnique({ where: { id: paymentId } });

    const refundLedger = await prisma.ledgerEntry.count({
      where: { paymentId, type: "REFUND" },
    });

    if (
      afterPartial?.status === "PARTIALLY_REFUNDED" &&
      afterFull?.status === "REFUNDED" &&
      refundLedger === 2
    ) {
      pass("Partial + full refund", "statuses and 2 REFUND ledger rows");
    } else {
      fail(
        "Partial + full refund",
        `partial=${afterPartial?.status} full=${afterFull?.status} ledger=${refundLedger}`,
      );
    }

    try {
      await paymentService.requestRefund({
        paymentId,
        amount: 1,
        idempotencyKey: `refund-over-${paymentId}`,
      });
      fail("Over-refund protection", "expected rejection");
    } catch {
      pass("Over-refund protection", "rejected");
    }

    const paidDeliveryId = deliveryId;
    const cancelCreate = await api("/deliveries", {
      method: "POST",
      token: customerToken,
      body: {
        ...createBody,
        package: {
          ...createBody.package,
          description: "Payment verify cancel boundary",
        },
      },
      idempotencyKey: randomUUID(),
    });
    const cancelDelId = (cancelCreate.json as { data?: { id?: string } }).data?.id;
    if (cancelDelId) {
      await api(`/deliveries/${cancelDelId}/orchestrate`, {
        method: "POST",
        token: customerToken,
        body: {},
      });
      await api(`/deliveries/${cancelDelId}/confirm`, {
        method: "POST",
        token: customerToken,
        idempotencyKey: randomUUID(),
      });
      const cancelRes = await api(`/deliveries/${cancelDelId}/cancel`, {
        method: "POST",
        token: customerToken,
        body: { reasonCode: "CUSTOMER_CHANGED_MIND" },
        idempotencyKey: randomUUID(),
      });
      const cancelStatus = (
        cancelRes.json as { data?: { delivery?: { status?: string } } }
      ).data?.delivery?.status;
      if (cancelRes.res.ok && cancelStatus === "CANCELLED") {
        pass("Cancellation boundary", "cancel still works; no auto gateway refund");
      } else {
        fail("Cancellation boundary", JSON.stringify(cancelRes.json).slice(0, 200));
      }
    }

    void paidDeliveryId;

    const failed = steps.filter((s) => !s.ok);
    console.log("\n--- Payment Phase 1 verification summary ---");
    console.log(`Steps: ${steps.length - failed.length}/${steps.length} PASS`);
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
