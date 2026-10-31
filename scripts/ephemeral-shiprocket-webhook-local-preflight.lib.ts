/**
 * Shared guards for local Shiprocket webhook ephemeral scripts (Docker Postgres only).
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { createProviderWebhookRouter } from "../src/modules/provider/webhook/provider-webhook.routes.js";

export const SHIPROCKET_WEBHOOK_LOCAL = {
  host: "127.0.0.1",
  port: "5433",
  database: "doot_shiprocket_auth_dev",
  serverPort: 5001,
  neutralWebhookPath: "/api/v1/providers/webhooks/tracking",
  providerWebhookEventMigration: "20260914160000_add_provider_webhook_events",
} as const;

function readDockerPostgresPassword(): string {
  const out = execSync(
    "docker inspect doot-pg-local --format '{{range .Config.Env}}{{println .}}{{end}}'",
    { encoding: "utf8" },
  );
  for (const line of out.split("\n")) {
    if (line.startsWith("POSTGRES_PASSWORD=")) {
      return line.slice("POSTGRES_PASSWORD=".length);
    }
  }
  throw new Error(
    "Could not resolve local Docker POSTGRES_PASSWORD (is doot-pg-local running?).",
  );
}

export function buildGuardedLocalDatabaseUrl(): string {
  const password = encodeURIComponent(readDockerPostgresPassword());
  const { host, port, database } = SHIPROCKET_WEBHOOK_LOCAL;
  return `postgresql://postgres:${password}@${host}:${port}/${database}?schema=public`;
}

export function assertGuardedLocalDatabaseUrl(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL.");
  }
  const { host, port, database } = SHIPROCKET_WEBHOOK_LOCAL;
  if (parsed.hostname !== host) {
    throw new Error(`DATABASE_URL host must be ${host}.`);
  }
  if (parsed.port !== port) {
    throw new Error(`DATABASE_URL port must be ${port}.`);
  }
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (dbName !== database) {
    throw new Error(`DATABASE_URL database must be ${database}.`);
  }
  const hostLower = parsed.hostname.toLowerCase();
  for (const fragment of ["supabase.co", "amazonaws.com", "neon.tech"]) {
    if (hostLower.includes(fragment)) {
      throw new Error("Refusing non-local database host.");
    }
  }
}

export function readWebhookTokenFromEnvFile(): string {
  const envPath = resolve(process.cwd(), ".env");
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    if (line.startsWith("SHIPROCKET_WEBHOOK_TOKEN=")) {
      const value = line.slice("SHIPROCKET_WEBHOOK_TOKEN=".length).trim();
      if (value.length > 0) {
        return value;
      }
    }
  }
  throw new Error("SHIPROCKET_WEBHOOK_TOKEN missing or empty in .env");
}

export async function assertProviderWebhookEventTableExists(
  prisma: PrismaClient,
): Promise<void> {
  try {
    await prisma.$queryRawUnsafe('SELECT 1 FROM "ProviderWebhookEvent" LIMIT 0');
  } catch {
    throw new Error(
      `ProviderWebhookEvent table missing — apply migration ${SHIPROCKET_WEBHOOK_LOCAL.providerWebhookEventMigration}`,
    );
  }
}

export function assertNeutralWebhookRouteRegistered(): void {
  const router = createProviderWebhookRouter();
  const hasTrackingPost = router.stack.some((layer) => {
    const route = layer.route;
    if (!route) {
      return false;
    }
    return route.path === "/tracking" && Boolean(route.methods.post);
  });
  if (!hasTrackingPost) {
    throw new Error(
      "Neutral POST /tracking route is not registered on provider webhook router.",
    );
  }
}

export function buildShiprocketDashboardWebhookServerEnv(input: {
  databaseUrl: string;
  webhookToken: string;
}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PORT: String(SHIPROCKET_WEBHOOK_LOCAL.serverPort),
    NODE_ENV: "development",
    DATABASE_URL: input.databaseUrl,
    DIRECT_URL: input.databaseUrl,
    SHIPROCKET_WEBHOOK_ENABLED: "true",
    SHIPROCKET_BOOKING_ENABLED: "false",
    SHIPROCKET_WEBHOOK_TOKEN: input.webhookToken,
    OPERATIONAL_POLLING_ENABLED: "false",
  };
}
