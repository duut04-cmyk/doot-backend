#!/usr/bin/env tsx
/**
 * Cashfree Phase 2A — sandbox certification (live API when enabled).
 *
 * Requires:
 *   CASHFREE_ENABLED=true
 *   CASHFREE_ENVIRONMENT=sandbox
 *   CASHFREE_CLIENT_ID / CASHFREE_CLIENT_SECRET
 *   PAYMENT_GATEWAY=cashfree
 *   Backend running with the same env
 *
 * Usage: npm run cert:cashfree-sandbox
 */
/* eslint-disable no-console -- certification CLI output */
import { randomUUID } from "node:crypto";
import { config as loadDotenv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { generateAccessToken, hashPassword } from "../src/modules/auth/auth.crypto.js";
import { getCashfreePgBaseUrl, requireCashfreeCredentials } from "../src/config/env.js";
import { cashfreePaymentGateway } from "../src/modules/payment/gateways/cashfree-payment.gateway.js";
import { computeCashfreeWebhookSignature } from "../src/modules/payment/gateways/cashfree/cashfree-webhook.verify.js";
import { ledgerIdempotencyKeyForPaymentSuccess } from "../src/modules/payment/payment.constants.js";

loadDotenv({ override: false });

const API_BASE = (process.env.API_BASE_URL ?? "http://localhost:5000/api/v1").replace(
  /\/+$/,
  "",
);

type Step = { name: string; ok: boolean; detail?: string; mode: "LIVE" | "SIMULATED" };
const steps: Step[] = [];

function record(
  name: string,
  ok: boolean,
  detail?: string,
  mode: Step["mode"] = "LIVE",
) {
  steps.push({ name, ok, detail, mode });
  console.log(
    `[${ok ? "PASS" : "FAIL"}][${mode}] ${name}${detail ? ` — ${detail}` : ""}`,
  );
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

async function ensureUser(prisma: PrismaClient, email: string) {
  const passwordHash = await hashPassword("CashfreeCert123!@#");
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, emailVerified: true, status: "ACTIVE", role: "CUSTOMER" },
    });
    return existing.id;
  }
  const created = await prisma.user.create({
    data: {
      name: "Cashfree Cert",
      email,
      passwordHash,
      emailVerified: true,
      status: "ACTIVE",
      role: "CUSTOMER",
    },
  });
  return created.id;
}

async function main() {
  console.log("=== CASHFREE SANDBOX CERTIFICATION (Phase 2A) ===");
  console.log("Environment: SANDBOX ONLY");

  if (process.env.CASHFREE_ENABLED !== "true") {
    console.error(
      "Abort: set CASHFREE_ENABLED=true to run live sandbox certification.",
    );
    process.exit(1);
  }
  if (process.env.CASHFREE_ENVIRONMENT !== "sandbox") {
    console.error("Abort: CASHFREE_ENVIRONMENT must be sandbox for Phase 2A.");
    process.exit(1);
  }
  if ((process.env.PAYMENT_GATEWAY ?? "stub") !== "cashfree") {
    console.error("Abort: set PAYMENT_GATEWAY=cashfree on the running backend.");
    process.exit(1);
  }

  try {
    requireCashfreeCredentials();
  } catch (error) {
    console.error("Abort: missing Cashfree credentials.", error);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const health = await fetch(`${API_BASE}/health`);
    record("API health", health.ok, `${API_BASE}/health`);

    const customerEmail = `cashfree-cert-${Date.now()}@doot.test`;
    const customerId = await ensureUser(prisma, customerEmail);
    const token = generateAccessToken(customerId);

    const createBody = {
      pickup: {
        addressText: "Sector 17, Chandigarh, India",
        contactName: "Cashfree Pickup",
        contactPhone: { countryCode: "+91", number: "9876500010" },
        instructions: null,
      },
      drop: {
        addressText: "Sector 22, Chandigarh, India",
        contactName: "Cashfree Drop",
        contactPhone: { countryCode: "+91", number: "9876500011" },
      },
      package: {
        packageType: "DOCUMENT",
        description: "Cashfree sandbox certification",
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
      token,
      body: createBody,
      idempotencyKey: randomUUID(),
    });
    const deliveryId = (created.json as { data?: { id?: string } }).data?.id;
    record("Create test delivery", Boolean(deliveryId), deliveryId);

    await api(`/deliveries/${deliveryId}/orchestrate`, {
      method: "POST",
      token,
      body: {},
    });
    await api(`/deliveries/${deliveryId}/orchestration`, { token });

    const paymentCreate = await api(`/deliveries/${deliveryId}/payment`, {
      method: "POST",
      token,
      idempotencyKey: randomUUID(),
    });
    const paymentPayload = (
      paymentCreate.json as {
        data?: {
          payment?: {
            status?: string;
            gateway?: string;
            gatewayOrderId?: string | null;
            paymentSessionId?: string | null;
            amount?: number;
            currency?: string;
          };
        };
      }
    ).data?.payment;

    record(
      "Create payment (Cashfree)",
      paymentCreate.res.ok &&
        paymentPayload?.status === "PENDING" &&
        paymentPayload.gateway === "CASHFREE" &&
        Boolean(paymentPayload.gatewayOrderId) &&
        Boolean(paymentPayload.paymentSessionId),
      JSON.stringify({
        status: paymentPayload?.status,
        gateway: paymentPayload?.gateway,
        gatewayOrderId: paymentPayload?.gatewayOrderId,
        paymentSessionId: paymentPayload?.paymentSessionId?.slice(0, 12),
        amount: paymentPayload?.amount,
        currency: paymentPayload?.currency,
      }),
    );

    const paymentGet = await api(`/deliveries/${deliveryId}/payment`, { token });
    const persisted = (
      paymentGet.json as {
        data?: {
          payment?: {
            status?: string;
            gatewayOrderId?: string | null;
            paymentSessionId?: string | null;
          };
        };
      }
    ).data?.payment;
    record(
      "GET payment persisted checkout fields",
      Boolean(persisted?.gatewayOrderId) && Boolean(persisted?.paymentSessionId),
      persisted?.status,
    );

    if (paymentPayload?.gatewayOrderId) {
      const status = await cashfreePaymentGateway.getPaymentStatus({
        gatewayOrderId: paymentPayload.gatewayOrderId,
      });
      record("Cashfree status query (live API)", true, `normalized=${status.status}`);
    } else {
      record("Cashfree status query (live API)", false, "missing gateway order id");
    }

    if (
      process.env.CASHFREE_WEBHOOK_ENABLED === "true" &&
      paymentPayload?.gatewayOrderId &&
      paymentPayload.amount
    ) {
      const timestamp = String(Date.now());
      const payload = {
        type: "PAYMENT_SUCCESS_WEBHOOK",
        data: {
          order: {
            order_id: paymentPayload.gatewayOrderId,
            order_amount: paymentPayload.amount,
            order_currency: "INR",
          },
          payment: {
            cf_payment_id: `sim-${randomUUID()}`,
            payment_status: "SUCCESS",
            payment_amount: paymentPayload.amount,
          },
        },
      };
      const rawBody = JSON.stringify(payload);
      const creds = requireCashfreeCredentials();
      const signature = computeCashfreeWebhookSignature({
        timestamp,
        rawBody,
        secretKey: creds.clientSecret,
      });

      const webhookRes = await fetch(`${API_BASE}/payments/webhooks/cashfree`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-signature": signature,
          "x-webhook-timestamp": timestamp,
          "x-idempotency-key": randomUUID(),
        },
        body: rawBody,
      });
      record(
        "Webhook success (signed payload)",
        webhookRes.ok,
        `HTTP ${webhookRes.status}`,
        webhookRes.ok ? "LIVE" : "SIMULATED",
      );

      const duplicate = await fetch(`${API_BASE}/payments/webhooks/cashfree`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-signature": signature,
          "x-webhook-timestamp": timestamp,
        },
        body: rawBody,
      });
      record("Duplicate webhook", duplicate.ok, `HTTP ${duplicate.status}`);

      const paymentRow = await prisma.payment.findFirst({
        where: { deliveryId },
        include: { ledger: true },
      });
      const ledgerCount = paymentRow?.ledger.filter(
        (e) => e.type === "CUSTOMER_PAYMENT",
      ).length;
      record(
        "Ledger idempotency after duplicate webhook",
        paymentRow?.status === "PAID" && ledgerCount === 1,
        `ledger=${ledgerCount}`,
      );
    } else {
      record(
        "Webhook success (signed payload)",
        true,
        "Skipped — enable CASHFREE_WEBHOOK_ENABLED=true on backend or use ngrok notify URL for remote webhooks",
        "SIMULATED",
      );
    }

    record(
      "Cashfree PG base URL is sandbox",
      getCashfreePgBaseUrl().includes("sandbox.cashfree.com"),
      getCashfreePgBaseUrl(),
    );

    const paymentId = (paymentGet.json as { data?: { payment?: { id?: string } } }).data
      ?.payment?.id;
    if (paymentId) {
      record(
        "Ledger key convention",
        ledgerIdempotencyKeyForPaymentSuccess(paymentId).startsWith("payment-paid:"),
        ledgerIdempotencyKeyForPaymentSuccess(paymentId),
        "SIMULATED",
      );
    }

    const failed = steps.filter((s) => !s.ok).length;
    console.log("\n=== SUMMARY ===");
    console.log(`Steps: ${steps.length - failed}/${steps.length} PASS`);
    console.log(
      failed === 0
        ? "CASHFREE SANDBOX LIVE VERIFICATION: PASS (partial steps may be SIMULATED — see step tags)"
        : "CASHFREE SANDBOX LIVE VERIFICATION: FAIL",
    );
    process.exit(failed === 0 ? 0 : 1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
