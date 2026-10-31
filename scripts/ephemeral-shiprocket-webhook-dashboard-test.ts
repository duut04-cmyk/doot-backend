/**
 * Phase 3A — keep local backend running for Shiprocket dashboard test webhook + HTTPS tunnel.
 * Ephemeral; delete when done. Does not modify .env or call Shiprocket APIs.
 */
import { spawn, type ChildProcess } from "node:child_process";
import {
  assertGuardedLocalDatabaseUrl,
  assertNeutralWebhookRouteRegistered,
  assertProviderWebhookEventTableExists,
  buildGuardedLocalDatabaseUrl,
  buildShiprocketDashboardWebhookServerEnv,
  readWebhookTokenFromEnvFile,
  SHIPROCKET_WEBHOOK_LOCAL,
} from "./ephemeral-shiprocket-webhook-local-preflight.lib.js";

async function runPreflight(): Promise<{ databaseUrl: string; webhookToken: string }> {
  const databaseUrl = buildGuardedLocalDatabaseUrl();
  assertGuardedLocalDatabaseUrl(databaseUrl);
  assertNeutralWebhookRouteRegistered();

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await assertProviderWebhookEventTableExists(prisma);
  } finally {
    await prisma.$disconnect();
  }

  const webhookToken = readWebhookTokenFromEnvFile();
  return { databaseUrl, webhookToken };
}

function printStartupSummary(): void {
  const { host, database, serverPort, neutralWebhookPath } = SHIPROCKET_WEBHOOK_LOCAL;
  console.log("Shiprocket dashboard webhook — local server ready for tunnel");
  console.log(`Local server: http://127.0.0.1:${serverPort}`);
  console.log(`Webhook path: ${neutralWebhookPath}`);
  console.log(`Database host: ${host}`);
  console.log(`Database name: ${database}`);
  console.log("SHIPROCKET_WEBHOOK_ENABLED: true (process env only; .env unchanged)");
  console.log("SHIPROCKET_BOOKING_ENABLED: false");
  console.log(`Neutral POST route registered: yes (${neutralWebhookPath})`);
  console.log("Press Ctrl+C to stop.");
}

async function main(): Promise<void> {
  const { databaseUrl, webhookToken } = await runPreflight();
  const serverEnv = buildShiprocketDashboardWebhookServerEnv({
    databaseUrl,
    webhookToken,
  });

  printStartupSummary();

  const child: ChildProcess = spawn("npx", ["tsx", "src/server.ts"], {
    cwd: process.cwd(),
    env: serverEnv,
    stdio: "inherit",
  });

  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`\nReceived ${signal}, shutting down...`);
    child.kill("SIGTERM");
    const forceTimer = setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }, 10_000);
    forceTimer.unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await new Promise<void>((resolvePromise, rejectPromise) => {
    child.on("error", rejectPromise);
    child.on("exit", (code, signal) => {
      if (shuttingDown || signal === "SIGTERM" || signal === "SIGINT") {
        resolvePromise();
        return;
      }
      if (code && code !== 0) {
        rejectPromise(new Error(`Server exited with code ${code}`));
        return;
      }
      resolvePromise();
    });
  });
}

main().catch((error) => {
  console.error(
    "Dashboard webhook server failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
