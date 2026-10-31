/**
 * Phase 2 — local Shiprocket webhook runtime verification (ephemeral).
 * Requires local Docker Postgres only. Does not modify .env or production data.
 */
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { SHIPROCKET_WEBHOOK_MAX_BODY_BYTES } from "../src/modules/provider/adapters/shiprocket/shiprocket-webhook.normalize.js";
import {
  assertGuardedLocalDatabaseUrl,
  buildGuardedLocalDatabaseUrl,
  buildShiprocketDashboardWebhookServerEnv,
  readWebhookTokenFromEnvFile,
  SHIPROCKET_WEBHOOK_LOCAL,
} from "./ephemeral-shiprocket-webhook-local-preflight.lib.js";

export { assertGuardedLocalDatabaseUrl } from "./ephemeral-shiprocket-webhook-local-preflight.lib.js";

const BASE_PATH = SHIPROCKET_WEBHOOK_LOCAL.neutralWebhookPath;

type HttpCase = {
  name: string;
  init?: RequestInit;
  body?: string;
  apiKey?: string | null;
  expectStatus: number;
  expectCode?: string;
  check?: (json: unknown) => void;
};

function syntheticFixture(runId: string): string {
  return JSON.stringify({
    awb: `DOOT-P2-${runId}`,
    sr_order_id: runId,
    order_id: runId,
    current_status: "IN TRANSIT",
    current_status_id: 17,
    current_timestamp: "2026-10-30 12:00:00",
    is_return: false,
    scans: [
      {
        date: "2026-10-30 12:00:00",
        activity: "Synthetic phase-2 scan",
        location: "LocalTest",
        status: "IN TRANSIT",
        status_id: 17,
      },
    ],
  });
}

function providerEventKey(rawBody: string): string {
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  return `SHIPROCKET:TRACKING:${payloadHash}`;
}

async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/v1/health`);
      if (res.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Backend did not become healthy in time.");
}

async function runHttpCase(_baseUrl: string, testCase: HttpCase): Promise<number> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (testCase.apiKey !== null && testCase.apiKey !== undefined) {
    headers["x-api-key"] = testCase.apiKey;
  }
  const res = await fetch(`${_baseUrl}${BASE_PATH}`, {
    method: "POST",
    headers,
    body: testCase.body,
    ...testCase.init,
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  if (res.status !== testCase.expectStatus) {
    throw new Error(
      `${testCase.name}: expected HTTP ${testCase.expectStatus}, got ${res.status}`,
    );
  }
  if (testCase.expectCode && json && typeof json === "object" && "error" in json) {
    const code = (json as { error?: { code?: string } }).error?.code;
    if (code !== testCase.expectCode) {
      throw new Error(
        `${testCase.name}: expected error code ${testCase.expectCode}, got ${code ?? "none"}`,
      );
    }
  }
  testCase.check?.(json);
  return res.status;
}

async function main(): Promise<void> {
  const dbUrl = buildGuardedLocalDatabaseUrl();
  assertGuardedLocalDatabaseUrl(dbUrl);
  const webhookToken = readWebhookTokenFromEnvFile();
  const port = SHIPROCKET_WEBHOOK_LOCAL.serverPort;
  const baseUrl = `http://127.0.0.1:${port}`;
  const runId = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;
  const fixture = syntheticFixture(runId);
  const eventKey = providerEventKey(fixture);

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  try {
    await prisma.$queryRawUnsafe('SELECT 1 FROM "ProviderWebhookEvent" LIMIT 0');
  } catch {
    console.log(
      `DB_CHECK: ProviderWebhookEvent table missing — apply ${SHIPROCKET_WEBHOOK_LOCAL.providerWebhookEventMigration}`,
    );
    process.exit(2);
  }

  const deliveryCountBefore = await prisma.delivery.count();
  const paymentCountBefore = await prisma.payment.count();

  const serverEnv = buildShiprocketDashboardWebhookServerEnv({
    databaseUrl: dbUrl,
    webhookToken,
  });

  let child: ChildProcess | null = null;
  const serverLog: string[] = [];

  try {
    child = spawn("npx", ["tsx", "src/server.ts"], {
      cwd: process.cwd(),
      env: serverEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      serverLog.push(chunk.toString());
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      serverLog.push(chunk.toString());
    });

    await waitForHealth(baseUrl, 20_000);

    const statuses: Record<string, number> = {};

    statuses.missing_key = await runHttpCase(baseUrl, {
      name: "missing x-api-key",
      body: fixture,
      apiKey: null,
      expectStatus: 401,
      expectCode: "INVALID_PROVIDER_WEBHOOK_SIGNATURE",
    });

    statuses.wrong_key = await runHttpCase(baseUrl, {
      name: "wrong x-api-key",
      body: fixture,
      apiKey: "intentionally-wrong-key",
      expectStatus: 401,
      expectCode: "INVALID_PROVIDER_WEBHOOK_SIGNATURE",
    });

    statuses.correct_key = await runHttpCase(baseUrl, {
      name: "correct x-api-key unmatched",
      body: fixture,
      apiKey: webhookToken,
      expectStatus: 200,
      check: (json) => {
        const data = (json as { data?: { processingStatus?: string; reason?: string } })
          .data;
        if (data?.processingStatus !== "IGNORED") {
          throw new Error("expected IGNORED processingStatus");
        }
        if (data?.reason !== "delivery_not_found") {
          throw new Error(
            `expected delivery_not_found reason, got ${data?.reason ?? "none"}`,
          );
        }
      },
    });

    statuses.duplicate = await runHttpCase(baseUrl, {
      name: "duplicate payload",
      body: fixture,
      apiKey: webhookToken,
      expectStatus: 200,
      check: (json) => {
        const data = (json as { data?: { duplicate?: boolean } }).data;
        if (data?.duplicate !== true) {
          throw new Error("expected duplicate true on replay");
        }
      },
    });

    statuses.malformed_json = await runHttpCase(baseUrl, {
      name: "malformed JSON",
      body: "{not-json",
      apiKey: webhookToken,
      expectStatus: 400,
      expectCode: "VALIDATION_ERROR",
    });

    const pad = "x".repeat(SHIPROCKET_WEBHOOK_MAX_BODY_BYTES + 64);
    statuses.oversized = await runHttpCase(baseUrl, {
      name: "oversized body",
      body: JSON.stringify({
        awb: "DOOT-P2-SYNTH-01",
        sr_order_id: "8888888888",
        pad,
      }),
      apiKey: webhookToken,
      expectStatus: 413,
      expectCode: "VALIDATION_ERROR",
    });

    const events = await prisma.providerWebhookEvent.findMany({
      where: { providerEventKey: eventKey },
      orderBy: { receivedAt: "desc" },
      take: 5,
    });

    const deliveryCountAfter = await prisma.delivery.count();
    const paymentCountAfter = await prisma.payment.count();

    const logBlob = serverLog.join("");
    const secretInLogs = logBlob.includes(webhookToken);

    let secretInPayload = false;
    for (const row of events) {
      const serialized = JSON.stringify(row.payload);
      if (serialized.includes(webhookToken)) {
        secretInPayload = true;
      }
    }

    const shiprocketApiInLogs = /api-sandbox\.shiprocket\.in|api\.shiprocket\.in/i.test(
      logBlob,
    );

    console.log("PHASE2_REPORT_BEGIN");
    console.log(
      JSON.stringify({
        databaseHost: SHIPROCKET_WEBHOOK_LOCAL.host,
        databaseName: SHIPROCKET_WEBHOOK_LOCAL.database,
        databasePort: SHIPROCKET_WEBHOOK_LOCAL.port,
        httpStatuses: statuses,
        providerEventKey: eventKey,
        persistedEventCount: events.length,
        processingStatus: events[0]?.processingStatus ?? null,
        processingError: events[0]?.processingError ?? null,
        signatureVerified: events[0]?.signatureVerified ?? null,
        duplicateBehavior: "second HTTP 200 with duplicate true",
        secretInServerLogs: secretInLogs,
        secretInStoredPayload: secretInPayload,
        deliveryCountDelta: deliveryCountAfter - deliveryCountBefore,
        paymentCountDelta: paymentCountAfter - paymentCountBefore,
        shiprocketOutboundApiInLogs: shiprocketApiInLogs,
        isolatedPort: port,
        envFileWebhookEnabled: "unchanged (verify separately)",
        bookingEnabledShell: false,
      }),
    );
    console.log("PHASE2_REPORT_END");
  } finally {
    if (child && !child.killed) {
      child.kill("SIGTERM");
      await new Promise<void>((resolvePromise) => {
        child!.once("exit", () => resolvePromise());
        setTimeout(() => {
          if (!child!.killed) {
            child!.kill("SIGKILL");
          }
          resolvePromise();
        }, 5_000);
      });
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    "PHASE2_FAILED:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
