import { Prisma } from "@prisma/client";
import { FINANCE_BUSINESS_TIMEZONE } from "./admin-finance.constants.js";
import { subtractMoneyStrings } from "./admin-finance.money.js";
import type {
  AdminFinanceTimeseriesPointDto,
  FinanceTimeseriesGranularity,
} from "./admin-finance.types.js";
import type { FinanceWindow } from "./admin-finance.schema.js";

type CollectionRow = { paidAt: Date; amount: Prisma.Decimal };
type RefundRow = { processedAt: Date; amount: Prisma.Decimal };

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function toIstParts(date: Date): { y: number; m: number; d: number } {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    y: ist.getUTCFullYear(),
    m: ist.getUTCMonth() + 1,
    d: ist.getUTCDate(),
  };
}

function bucketKey(date: Date, granularity: FinanceTimeseriesGranularity): string {
  const { y, m, d } = toIstParts(date);
  if (granularity === "month") {
    return `${y}-${String(m).padStart(2, "0")}`;
  }
  if (granularity === "week") {
    const utcMidnightIst = Date.UTC(y, m - 1, d);
    const day = new Date(utcMidnightIst).getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(utcMidnightIst - diff * 86_400_000);
    const parts = toIstParts(new Date(monday.getTime() - IST_OFFSET_MS));
    return `${parts.y}-W${String(parts.m).padStart(2, "0")}${String(parts.d).padStart(2, "0")}`;
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function bucketLabel(key: string, granularity: FinanceTimeseriesGranularity): string {
  if (granularity === "month") {
    return `${key} (${FINANCE_BUSINESS_TIMEZONE})`;
  }
  if (granularity === "week") {
    return `Week of ${key} (${FINANCE_BUSINESS_TIMEZONE})`;
  }
  return `${key} (${FINANCE_BUSINESS_TIMEZONE})`;
}

function enumerateBucketKeys(
  window: FinanceWindow,
  granularity: FinanceTimeseriesGranularity,
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  let cursor = new Date(window.from.getTime());
  while (cursor.getTime() < window.toExclusive.getTime()) {
    const key = bucketKey(cursor, granularity);
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
    cursor = new Date(cursor.getTime() + 60 * 60 * 1000);
  }
  return keys;
}

export function buildFinanceTimeseries(input: {
  window: FinanceWindow;
  granularity: FinanceTimeseriesGranularity;
  collections: CollectionRow[];
  successfulRefunds: RefundRow[];
}): AdminFinanceTimeseriesPointDto[] {
  const collectionByBucket = new Map<string, Prisma.Decimal>();
  for (const row of input.collections) {
    const key = bucketKey(row.paidAt, input.granularity);
    const prev = collectionByBucket.get(key) ?? new Prisma.Decimal(0);
    collectionByBucket.set(key, prev.add(row.amount));
  }

  const refundByBucket = new Map<string, Prisma.Decimal>();
  for (const row of input.successfulRefunds) {
    if (!row.processedAt) continue;
    const key = bucketKey(row.processedAt, input.granularity);
    const prev = refundByBucket.get(key) ?? new Prisma.Decimal(0);
    refundByBucket.set(key, prev.add(row.amount));
  }

  const keys = enumerateBucketKeys(input.window, input.granularity);
  return keys.map((key) => {
    const collections = (collectionByBucket.get(key) ?? new Prisma.Decimal(0)).toFixed(
      2,
    );
    const successfulRefunds = (
      refundByBucket.get(key) ?? new Prisma.Decimal(0)
    ).toFixed(2);
    return {
      bucketStart: key,
      bucketLabel: bucketLabel(key, input.granularity),
      collections,
      successfulRefunds,
      net: subtractMoneyStrings(collections, successfulRefunds),
    };
  });
}
