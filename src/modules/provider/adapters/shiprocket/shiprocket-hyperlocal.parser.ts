import type { ParsedHyperlocalRateCandidate } from "./shiprocket.types.js";
import {
  shiprocketHyperlocalRateEntrySchema,
  shiprocketHyperlocalServiceabilityResponseSchema,
} from "./shiprocket.types.js";

function parseAmount(entry: Record<string, unknown>): number | null {
  const raw = entry.rates ?? entry.rate;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function parseEtaMinutes(entry: Record<string, unknown>): number | null {
  const candidates = [entry.eta, entry.etd, entry.estimated_delivery_days];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.round(value);
    }
    if (typeof value === "string") {
      const match = value.match(/(\d+(?:\.\d+)?)/);
      if (match) {
        const parsed = Number.parseFloat(match[1]!);
        if (Number.isFinite(parsed)) {
          return Math.round(parsed);
        }
      }
    }
  }
  return null;
}

function buildQuoteId(entry: Record<string, unknown>, index: number): string {
  const explicit =
    entry.rate_id ?? entry.id ?? entry.courier_id ?? entry.courier_company_id;
  if (explicit != null && String(explicit).length > 0) {
    return String(explicit);
  }
  const name = entry.courier_name ?? "courier";
  return `${String(name)}-${index}`;
}

export function parseShiprocketHyperlocalServiceability(body: unknown): {
  success: boolean;
  candidates: ParsedHyperlocalRateCandidate[];
  rawEntries: unknown[];
} {
  const parsed = shiprocketHyperlocalServiceabilityResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { success: false, candidates: [], rawEntries: [] };
  }

  const status = parsed.data.status;
  const success =
    status === true ||
    status === 1 ||
    status === "1" ||
    String(status).toLowerCase() === "true";

  if (!success) {
    return { success: false, candidates: [], rawEntries: parsed.data.data ?? [] };
  }

  const entries = parsed.data.data ?? [];
  const candidates: ParsedHyperlocalRateCandidate[] = [];

  entries.forEach((entry, index) => {
    const row = shiprocketHyperlocalRateEntrySchema.parse(entry);
    const amount = parseAmount(row);
    if (amount == null) {
      return;
    }
    candidates.push({
      courierName: typeof row.courier_name === "string" ? row.courier_name : null,
      amountInr: amount,
      providerQuoteId: buildQuoteId(row, index),
      estimatedDeliveryMinutes: parseEtaMinutes(row),
      raw: row,
    });
  });

  return { success: true, candidates, rawEntries: entries };
}
