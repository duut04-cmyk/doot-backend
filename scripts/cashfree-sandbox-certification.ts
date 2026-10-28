#!/usr/bin/env tsx
/**
 * Cashfree sandbox E2E certification harness.
 *
 * Requires backend running with PAYMENT_GATEWAY=cashfree, CASHFREE_* sandbox,
 * ENABLE_MOCK_PROVIDER_ADAPTER=true, and same Cashfree credentials as this script.
 *
 * Usage: npm run cert:cashfree-sandbox
 * See backend/docs/cashfree-sandbox-e2e-certification.md for manual checkout + ngrok.
 */
/* eslint-disable no-console -- certification CLI output */
import { randomUUID } from "node:crypto";
import { config as loadDotenv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { generateAccessToken, hashPassword } from "../src/modules/auth/auth.crypto.js";
import { getCashfreePgBaseUrl, requireCashfreeCredentials } from "../src/config/env.js";
import { cashfreePaymentGateway } from "../src/modules/payment/gateways/cashfree-payment.gateway.js";
import { computeCashfreeWebhookSignature } from "../src/modules/payment/gateways/cashfree/cashfree-webhook.verify.js";
import { paymentService } from "../src/modules/payment/payment.service.js";
import {
  CERT_SIMULATED_CF_PAYMENT_PREFIX,
  CertStepRecorder,
  buildCertSummary,
  classifyPaidTier,
  mergePgBaseUrl,
  paymentSessionDiagnostics,
  readCashfreeCertConfig,
  readCertEnvFromProcess,
  validateCertPreflight,
  validatePaymentSessionShape,
} from "./lib/cashfree-cert/index.js";

loadDotenv({ override: false });

const API_BASE = (process.env.API_BASE_URL ?? "http://localhost:5000/api/v1").replace(
  /\/+$/,
  "",
);

const recorder = new CertStepRecorder();

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
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail.endsWith("@doot.test")) {
    throw new Error(`Cert harness may only seed users on @doot.test (got ${email}).`);
  }
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_INTERNAL_TEST_USER_SEED !== "true"
  ) {
    throw new Error(
      "Refusing to seed cert users in production. Set ALLOW_INTERNAL_TEST_USER_SEED=true to override.",
    );
  }

  const passwordHash = await hashPassword("CashfreeCert123!@#");
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        emailVerified: true,
        status: "ACTIVE",
        role: "CUSTOMER",
        phoneCountryCode: "+91",
        phoneNumber: "9876500000",
      },
    });
    return existing.id;
  }
  return prisma.user
    .create({
      data: {
        name: "Cashfree Cert",
        email,
        passwordHash,
        emailVerified: true,
        status: "ACTIVE",
        role: "CUSTOMER",
        phoneCountryCode: "+91",
        phoneNumber: "9876500000",
      },
      select: { id: true },
    })
    .then((u) => u.id);
}

type CustomerPaymentPayload = {
  id?: string;
  status?: string;
  gateway?: string;
  gatewayOrderId?: string | null;
  paymentSessionId?: string | null;
  amount?: number;
  currency?: string;
};

function readPaymentPayload(json: unknown): CustomerPaymentPayload | undefined {
  return (json as { data?: { payment?: CustomerPaymentPayload } }).data?.payment;
}

async function loadPaidTierFromDb(prisma: PrismaClient, deliveryId: string) {
  const payment = await prisma.payment.findFirst({
    where: { deliveryId },
    include: {
      attempts: { orderBy: { attemptNumber: "desc" }, take: 1 },
    },
  });
  if (!payment) {
    return { tier: "NONE" as const, payment: null, attemptGatewayPaymentId: null };
  }
  const attemptGpid = payment.attempts[0]?.gatewayPaymentId ?? null;
  const tier = classifyPaidTier({
    paymentStatus: payment.status,
    gatewayPaymentId: attemptGpid,
  });
  return { tier, payment, attemptGatewayPaymentId: attemptGpid };
}

async function pollUntilPaid(
  deliveryId: string,
  token: string,
  timeoutMs: number,
  intervalMs: number,
): Promise<CustomerPaymentPayload | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { json } = await api(`/deliveries/${deliveryId}/payment`, { token });
    const payment = readPaymentPayload(json);
    if (payment?.status === "PAID") {
      return payment ?? null;
    }
    if (payment?.status === "FAILED") {
      return payment;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

async function postSimulatedPaymentSuccessWebhook(input: {
  gatewayOrderId: string;
  amount: number;
}) {
  const timestamp = String(Date.now());
  const payload = {
    type: "PAYMENT_SUCCESS_WEBHOOK",
    data: {
      order: {
        order_id: input.gatewayOrderId,
        order_amount: input.amount,
        order_currency: "INR",
      },
      payment: {
        cf_payment_id: `${CERT_SIMULATED_CF_PAYMENT_PREFIX}${randomUUID()}`,
        payment_status: "SUCCESS",
        payment_amount: input.amount,
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

  return fetch(`${API_BASE}/payments/webhooks/cashfree`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-webhook-signature": signature,
      "x-webhook-timestamp": timestamp,
      "x-idempotency-key": randomUUID(),
    },
    body: rawBody,
  });
}

async function main() {
  console.log("=== CASHFREE SANDBOX E2E CERTIFICATION ===");

  const certConfig = readCashfreeCertConfig();
  const preflight = validateCertPreflight(
    mergePgBaseUrl(readCertEnvFromProcess(), getCashfreePgBaseUrl()),
  );
  if (!preflight.ok) {
    for (const err of preflight.errors) {
      console.error(`Abort: ${err}`);
    }
    process.exit(1);
  }

  try {
    requireCashfreeCredentials();
  } catch (error) {
    console.error("Abort: missing Cashfree credentials.", error);
    process.exit(1);
  }

  console.log(`PG host: ${new URL(getCashfreePgBaseUrl()).hostname}`);
  console.log(
    "Backend must use PAYMENT_GATEWAY=cashfree and ENABLE_MOCK_PROVIDER_ADAPTER=true",
  );

  const prisma = new PrismaClient();
  const runFlags = {
    paidTier: "NONE" as ReturnType<typeof classifyPaidTier>,
    checkoutVerified: false,
    externalWebhookVerified: false,
    refundReconciled: false,
    requireExternalWebhook: certConfig.requireExternalWebhook,
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    recorder.record("Database connectivity", "PASS", "LIVE_API", "SELECT 1 ok");
  } catch {
    recorder.record("Database connectivity", "FAIL", "LIVE_API", "cannot connect");
    process.exit(1);
  }

  const health = await fetch(`${API_BASE}/health`);
  recorder.record(
    "API health",
    health.ok ? "PASS" : "FAIL",
    "LIVE_API",
    `${API_BASE}/health HTTP ${health.status}`,
  );
  if (!health.ok) {
    process.exit(1);
  }

  let deliveryId = certConfig.resumeDeliveryId;
  let token: string;

  if (deliveryId) {
    const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) {
      recorder.record(
        "Resume delivery",
        "FAIL",
        "BLOCKED",
        "CASHFREE_CERT_DELIVERY_ID not found",
      );
      process.exit(1);
    }
    token = generateAccessToken(delivery.customerId);
    recorder.record("Resume delivery", "PASS", "LIVE_API", deliveryId);
  } else {
    // Reuse one harness account so admin customer lists are not flooded.
    // `@doot.test` emails are excluded from admin customer listing.
    const customerEmail = "cashfree-cert@doot.test";
    const customerId = await ensureUser(prisma, customerEmail);
    token = generateAccessToken(customerId);

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
        description: "Cashfree sandbox E2E certification",
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
    deliveryId = (created.json as { data?: { id?: string } }).data?.id;
    recorder.record(
      "Create test delivery",
      created.res.ok && Boolean(deliveryId) ? "PASS" : "FAIL",
      "LIVE_API",
      deliveryId ?? `HTTP ${created.res.status}`,
    );
    if (!deliveryId) {
      process.exit(1);
    }

    const orch = await api(`/deliveries/${deliveryId}/orchestrate`, {
      method: "POST",
      token,
      body: {},
    });
    recorder.record(
      "Orchestrate delivery",
      orch.res.ok ? "PASS" : "FAIL",
      "LIVE_API",
      `HTTP ${orch.res.status}`,
    );
    if (!orch.res.ok) {
      process.exit(1);
    }
  }

  if (!deliveryId) {
    process.exit(1);
  }

  const paymentCreate = await api(`/deliveries/${deliveryId}/payment`, {
    method: "POST",
    token,
    idempotencyKey: randomUUID(),
  });
  const paymentPayload = readPaymentPayload(paymentCreate.json);
  const sessionCheck = validatePaymentSessionShape(paymentPayload?.paymentSessionId);
  const sessionDiag = paymentSessionDiagnostics(paymentPayload?.paymentSessionId);
  const orderIdOk = Boolean(paymentPayload?.gatewayOrderId?.startsWith("DOOT-"));

  const createPaymentOk =
    paymentCreate.res.ok &&
    paymentPayload?.status === "PENDING" &&
    paymentPayload.gateway === "CASHFREE" &&
    orderIdOk &&
    sessionCheck.ok;

  recorder.record(
    "Create payment (Cashfree via API)",
    createPaymentOk ? "PASS" : "FAIL",
    "LIVE_API",
    JSON.stringify({
      httpStatus: paymentCreate.res.status,
      status: paymentPayload?.status,
      gateway: paymentPayload?.gateway,
      gatewayOrderId: paymentPayload?.gatewayOrderId,
      ...sessionDiag,
      sessionValidation: sessionCheck.ok
        ? "ok"
        : (sessionCheck as { reason: string }).reason,
      amount: paymentPayload?.amount,
      currency: paymentPayload?.currency,
    }),
  );

  if (!createPaymentOk) {
    const summary = buildCertSummary(recorder, { ...runFlags, paidTier: "NONE" });
    console.log("\n=== SUMMARY ===");
    console.log(summary.headline);
    process.exit(1);
  }

  const paymentGet = await api(`/deliveries/${deliveryId}/payment`, { token });
  const persisted = readPaymentPayload(paymentGet.json);
  const persistOk =
    persisted?.gatewayOrderId === paymentPayload?.gatewayOrderId &&
    persisted?.paymentSessionId === paymentPayload?.paymentSessionId;
  recorder.record(
    "GET payment matches persisted checkout fields",
    persistOk ? "PASS" : "FAIL",
    "LIVE_API",
    persisted?.status,
  );

  if (paymentPayload?.gatewayOrderId) {
    try {
      const status = await cashfreePaymentGateway.getPaymentStatus({
        gatewayOrderId: paymentPayload.gatewayOrderId,
      });
      recorder.record(
        "Cashfree GET order payments (cert client LIVE_API)",
        "PASS",
        "LIVE_API",
        `normalized=${status.status}`,
      );
    } catch (error) {
      recorder.record(
        "Cashfree GET order payments (cert client LIVE_API)",
        "FAIL",
        "LIVE_API",
        error instanceof Error ? error.message : "query failed",
      );
    }
  }

  console.log("\n--- Manual checkout checkpoint ---");
  console.log(`Delivery ID: ${deliveryId}`);
  if (paymentPayload?.gatewayOrderId) {
    console.log(`Cashfree order ID: ${paymentPayload.gatewayOrderId}`);
  }
  console.log(
    "Complete sandbox payment in customer app (see docs/cashfree-sandbox-e2e-certification.md).",
  );
  console.log(
    "Strict LIVE_E2E: backend must log cashfree_webhook_received + payment_webhook_processed (PAYMENT_SUCCESS).",
  );
  console.log(
    "Dashboard test ping (type WEBHOOK) may return HTTP 200 IGNORED — it does not mark PAID.",
  );
  console.log(`Polling GET /payment for up to ${certConfig.paidTimeoutMs}ms...\n`);

  let paidPoll = await pollUntilPaid(
    deliveryId,
    token,
    certConfig.paidTimeoutMs,
    certConfig.pollIntervalMs,
  );

  if (paidPoll?.status !== "PAID" && certConfig.runSimulatedWebhook) {
    if (
      process.env.CASHFREE_WEBHOOK_ENABLED === "true" &&
      paymentPayload?.gatewayOrderId &&
      paymentPayload.amount
    ) {
      const webhookRes = await postSimulatedPaymentSuccessWebhook({
        gatewayOrderId: paymentPayload.gatewayOrderId,
        amount: paymentPayload.amount,
      });
      recorder.record(
        "Simulated PAYMENT_SUCCESS webhook (handler test only)",
        webhookRes.ok ? "PASS" : "FAIL",
        "SIMULATED",
        `HTTP ${webhookRes.status}`,
      );
      paidPoll = await pollUntilPaid(
        deliveryId,
        token,
        15_000,
        certConfig.pollIntervalMs,
      );
    } else {
      recorder.record(
        "Simulated PAYMENT_SUCCESS webhook (handler test only)",
        "SKIP",
        "SIMULATED",
        "CASHFREE_WEBHOOK_ENABLED=false on backend",
      );
    }
  }

  if (paidPoll?.status === "PAID") {
    runFlags.checkoutVerified = true;
  }

  const dbPaidAfterPoll = await loadPaidTierFromDb(prisma, deliveryId);
  if (paidPoll?.status === "PAID") {
    const pollMode =
      dbPaidAfterPoll.tier === "LIVE_E2E"
        ? "LIVE_E2E"
        : dbPaidAfterPoll.tier === "SIMULATED"
          ? "SIMULATED"
          : "LIVE_API";
    recorder.record("Payment reached PAID", "PASS", pollMode, "via poll");
  } else {
    const blockedDetail =
      paidPoll?.status === "FAILED"
        ? "payment FAILED"
        : "timeout — complete browser checkout or enable CASHFREE_CERT_RUN_SIMULATED_WEBHOOK";
    recorder.record("Payment reached PAID", "SKIP", "BLOCKED", blockedDetail);
    if (paidPoll?.status !== "FAILED" && certConfig.requireExternalWebhook) {
      console.log("\n--- Strict E2E blocked (no PAID) ---");
      console.log(`Delivery ID: ${deliveryId}`);
      if (paymentPayload?.gatewayOrderId) {
        console.log(
          `Expected Cashfree order_id in webhook: ${paymentPayload.gatewayOrderId}`,
        );
      }
      console.log(
        "Check: ngrok URL matches CASHFREE_NOTIFY_URL, sandbox payment completed, PAYMENT_SUCCESS subscribed.",
      );
      console.log(
        "Resume after checkout: CASHFREE_CERT_DELIVERY_ID=<delivery-id> npm run cert:cashfree-sandbox",
      );
    }
  }

  const dbPaid = dbPaidAfterPoll;
  runFlags.paidTier = dbPaid.tier;
  runFlags.externalWebhookVerified = dbPaid.tier === "LIVE_E2E";

  recorder.record(
    "PAID tier classification",
    dbPaid.tier !== "NONE" ? "PASS" : "SKIP",
    dbPaid.tier === "LIVE_E2E"
      ? "LIVE_E2E"
      : dbPaid.tier === "SIMULATED"
        ? "SIMULATED"
        : "BLOCKED",
    `tier=${dbPaid.tier}`,
  );

  if (certConfig.requireExternalWebhook && dbPaid.tier !== "LIVE_E2E") {
    recorder.record(
      "External webhook required",
      "FAIL",
      "BLOCKED",
      "CASHFREE_CERT_REQUIRE_EXTERNAL_WEBHOOK=true but PAID tier is not LIVE_E2E",
    );
  } else if (certConfig.requireExternalWebhook) {
    recorder.record(
      "External webhook required",
      "PASS",
      "LIVE_E2E",
      "non-sim gateway payment id",
    );
  }

  if (dbPaid.tier !== "NONE") {
    const confirmMode = dbPaid.tier === "LIVE_E2E" ? "LIVE_E2E" : "SIMULATED";
    const confirmed = await api(`/deliveries/${deliveryId}/confirm`, {
      method: "POST",
      token,
      body: {},
      idempotencyKey: randomUUID(),
    });
    const bookedStatus = (
      confirmed.json as { data?: { delivery?: { status?: string } } }
    ).data?.delivery?.status;
    recorder.record(
      "Confirm after verified PAID",
      confirmed.res.ok && bookedStatus === "BOOKED" ? "PASS" : "FAIL",
      confirmMode,
      `HTTP ${confirmed.res.status} status=${bookedStatus ?? "n/a"}`,
    );

    if (confirmed.res.ok && bookedStatus === "BOOKED") {
      const cancelKey = randomUUID();
      const cancelRes = await api(`/deliveries/${deliveryId}/cancel`, {
        method: "POST",
        token,
        body: {
          reasonCode: "CUSTOMER_CHANGED_MIND",
          reasonMessage: "Cashfree E2E cert cancel",
        },
        idempotencyKey: cancelKey,
      });
      const cancelData = cancelRes.json as {
        data?: {
          delivery?: { status?: string };
          refund?: {
            refundId?: string;
            status?: string;
            amount?: number;
          } | null;
        };
      };
      const cancelled = cancelData.data?.delivery?.status === "CANCELLED";
      recorder.record(
        "Cancel booked prepaid delivery",
        cancelRes.res.ok && cancelled ? "PASS" : "FAIL",
        confirmMode,
        `HTTP ${cancelRes.res.status}`,
      );

      const refundSummary = cancelData.data?.refund;
      if (refundSummary?.refundId && paymentPayload?.amount) {
        const refundDeadline = Date.now() + certConfig.refundTimeoutMs;
        let finalRefund = await prisma.refund.findUnique({
          where: { id: refundSummary.refundId },
        });

        while (
          finalRefund &&
          finalRefund.status !== "SUCCESS" &&
          finalRefund.status !== "FAILED" &&
          Date.now() < refundDeadline
        ) {
          try {
            await paymentService.reconcileRefundStatus(refundSummary.refundId);
          } catch {
            // poll until timeout
          }
          finalRefund = await prisma.refund.findUnique({
            where: { id: refundSummary.refundId },
          });
          if (finalRefund?.status === "SUCCESS" || finalRefund?.status === "FAILED") {
            break;
          }
          await new Promise((r) => setTimeout(r, certConfig.pollIntervalMs));
        }

        if (finalRefund?.gatewayRefundId && paymentPayload.gatewayOrderId) {
          try {
            const cfRefund = await cashfreePaymentGateway.getRefundStatus({
              gatewayOrderId: paymentPayload.gatewayOrderId,
              gatewayRefundId: finalRefund.gatewayRefundId,
            });
            recorder.record(
              "Cashfree GET refund status (cert client LIVE_API)",
              "PASS",
              "LIVE_API",
              `status=${cfRefund.status}`,
            );
          } catch (error) {
            recorder.record(
              "Cashfree GET refund status (cert client LIVE_API)",
              "FAIL",
              "LIVE_API",
              error instanceof Error ? error.message : "failed",
            );
          }
        }

        const paymentAfter = await prisma.payment.findFirst({
          where: { deliveryId },
          include: { ledger: true, refunds: true },
        });
        const ledgerPayments = paymentAfter?.ledger.filter(
          (e) => e.type === "CUSTOMER_PAYMENT",
        ).length;
        const refundLedger = paymentAfter?.ledger.filter(
          (e) => e.type === "REFUND",
        ).length;
        const amountMatch =
          refundSummary.amount === paymentPayload.amount ||
          Number(finalRefund?.amount) === paymentPayload.amount;

        runFlags.refundReconciled = finalRefund?.status === "SUCCESS";
        recorder.record(
          "Refund reconciled to SUCCESS",
          runFlags.refundReconciled ? "PASS" : "SKIP",
          runFlags.refundReconciled ? "LIVE_API" : "BLOCKED",
          `refundStatus=${finalRefund?.status ?? "unknown"} paymentStatus=${paymentAfter?.status}`,
        );
        recorder.record(
          "Refund amount matches paid amount",
          amountMatch ? "PASS" : "FAIL",
          "LIVE_API",
          `refund=${refundSummary.amount} paid=${paymentPayload.amount}`,
        );
        const ledgerOk = ledgerPayments === 1 && (refundLedger ?? 0) >= 1;
        recorder.record(
          "Ledger payment/refund entries",
          finalRefund?.status === "SUCCESS" ? (ledgerOk ? "PASS" : "FAIL") : "SKIP",
          finalRefund?.status === "SUCCESS" ? "LIVE_API" : "BLOCKED",
          `customerPayments=${ledgerPayments} refundEntries=${refundLedger ?? 0}`,
        );

        const duplicateRefundCount = await prisma.refund.count({
          where: { paymentId: paymentAfter!.id, status: "SUCCESS" },
        });
        recorder.record(
          "No duplicate SUCCESS refunds",
          duplicateRefundCount <= 1 ? "PASS" : "FAIL",
          "LIVE_API",
          `count=${duplicateRefundCount}`,
        );
      } else if (cancelled) {
        recorder.record(
          "Refund on cancel",
          "SKIP",
          "BLOCKED",
          "no refund summary on cancel response",
        );
      }
    }
  } else {
    const blocked = await api(`/deliveries/${deliveryId}/confirm`, {
      method: "POST",
      token,
      body: {},
      idempotencyKey: randomUUID(),
    });
    const errCode = (blocked.json as { error?: { code?: string } }).error?.code;
    recorder.record(
      "Confirm blocked when unpaid",
      !blocked.res.ok && errCode === "PAYMENT_REQUIRED" ? "PASS" : "FAIL",
      "LIVE_API",
      `HTTP ${blocked.res.status} code=${errCode ?? "n/a"}`,
    );
  }

  const summary = buildCertSummary(recorder, runFlags);
  console.log("\n=== SUMMARY ===");
  console.log(
    `${summary.stepsPassed}/${summary.stepsTotal} steps passed (${summary.failCount} failed)`,
  );
  console.log(summary.headline);
  for (const note of summary.notes) {
    console.log(`  • ${note}`);
  }
  console.log(
    "\nStep modes: LIVE_API = Cashfree HTTP; LIVE_E2E = real checkout/webhook signal;",
  );
  console.log("SIMULATED = local signed webhook; BLOCKED = not verified in this run.");

  process.exit(summary.automatedPass ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
