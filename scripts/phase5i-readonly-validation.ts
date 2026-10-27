/**
 * Phase 5I read-only validation against BACKEND + DATABASE_URL (no writes).
 * Usage: npx tsx scripts/phase5i-readonly-validation.ts
 */
import "dotenv/config";
import { resolveReportingWindow } from "../../admin-panel/src/lib/reportingDateRange.ts";
import { getPrismaClient as prismaClient } from "../src/config/database.js";

const BACKEND = process.env.PHASE5I_BACKEND_URL ?? "http://127.0.0.1:5000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

type Json = Record<string, unknown>;

async function adminLogin(): Promise<string | null> {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    return null;
  }
  const res = await fetch(`${BACKEND}/api/v1/auth/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) {
    console.log(`admin_login_failed status=${res.status}`);
    return null;
  }
  const body = (await res.json()) as { data?: { accessToken?: string } };
  return body.data?.accessToken ?? null;
}

async function getJson(
  path: string,
  token: string,
): Promise<{ status: number; body: Json }> {
  const res = await fetch(`${BACKEND}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json()) as Json;
  return { status: res.status, body };
}

async function countDeliveries(from: Date, toExclusive: Date): Promise<number> {
  const prisma = prismaClient();
  return prisma.delivery.count({
    where: { createdAt: { gte: from, lt: toExclusive } },
  });
}

async function countOrchestrationRuns(from: Date, toExclusive: Date): Promise<number> {
  const prisma = prismaClient();
  return prisma.orchestrationRequest.count({
    where: { createdAt: { gte: from, lt: toExclusive } },
  });
}

async function main() {
  console.log("=== Phase 5I read-only validation ===");
  console.log(`backend=${BACKEND}`);
  console.log(
    `admin_credentials=${ADMIN_EMAIL ? "present" : "missing (ADMIN_EMAIL/ADMIN_PASSWORD)"}`,
  );

  const health = await fetch(`${BACKEND}/health`)
    .then((r) => r.status)
    .catch(() => 0);
  console.log(`health_http=${health}`);

  const prisma = prismaClient();
  const migrationPending = await prisma.$queryRaw<
    { migration_name: string }[]
  >`SELECT migration_name FROM _prisma_migrations WHERE migration_name = '20261024150000_add_platform_service_fee_runtime_setting' AND finished_at IS NOT NULL`
    .then((rows) => rows.length === 0)
    .catch(() => "unknown");
  console.log(
    `migration_platform_service_fee_enum_applied=${migrationPending === true ? "no" : migrationPending === false ? "yes" : migrationPending}`,
  );

  const token = await adminLogin();
  if (!token) {
    console.log("skip_api_checks=true (no admin token)");
    await prisma.$disconnect();
    return;
  }

  const settings = await getJson("/api/v1/admin/settings", token);
  console.log(`GET_settings_status=${settings.status}`);
  const runtime = (settings.body.data as Json | undefined)?.runtime as Json | undefined;
  const feeMeta = (runtime?.pricing as Json | undefined)?.platformServiceFeePercent as
    Json | undefined;
  if (feeMeta) {
    console.log(
      `platform_service_fee value=${feeMeta.value} source=${feeMeta.source} version=${feeMeta.version}`,
    );
  }
  const quoteMeta = (runtime?.booking as Json | undefined)?.quoteMaxAgeSeconds as
    Json | undefined;
  if (quoteMeta) {
    console.log(
      `booking_quote_max_age value=${quoteMeta.value} source=${quoteMeta.source} version=${quoteMeta.version}`,
    );
  }

  for (const preset of ["7d", "30d", "month"] as const) {
    const window = resolveReportingWindow(preset);
    const from = new Date(window.from);
    const toExclusive = new Date(window.to);
    const q = new URLSearchParams({ from: window.from, to: window.to });
    const summary = await getJson(`/api/v1/admin/reporting/summary?${q}`, token);
    const data = summary.body.data as Json | undefined;
    const apiTotal = (data?.deliveriesCreated as Json | undefined)?.total;
    const apiRuns = (data?.orchestrationRuns as Json | undefined)?.totalRuns;
    const dbDeliveries = await countDeliveries(from, toExclusive);
    const dbRuns = await countOrchestrationRuns(from, toExclusive);
    console.log(
      `preset=${preset} from=${window.from} to=${window.to} summary_status=${summary.status} deliveries_api=${apiTotal} deliveries_db=${dbDeliveries} runs_api=${apiRuns} runs_db=${dbRuns} deliveries_match=${apiTotal === dbDeliveries} runs_match=${apiRuns === dbRuns}`,
    );
  }

  const unauth = await fetch(
    `${BACKEND}/api/v1/admin/reporting/summary?from=2026-01-01T00:00:00.000Z&to=2026-01-02T00:00:00.000Z`,
  );
  console.log(`reporting_unauthenticated_status=${unauth.status}`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
