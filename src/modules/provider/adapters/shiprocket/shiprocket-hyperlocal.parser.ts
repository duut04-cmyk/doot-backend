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

function isExplicitStatusTrue(status: unknown): boolean {
  return (
    status === true ||
    status === 1 ||
    status === "1" ||
    String(status).toLowerCase() === "true"
  );
}

function isExplicitStatusFalse(status: unknown): boolean {
  return (
    status === false ||
    status === 0 ||
    status === "0" ||
    String(status).toLowerCase() === "false"
  );
}

export type ShiprocketHyperlocalParseResult = {
  /** Response envelope was understood (includes valid zero-candidate results). */
  success: boolean;
  /** Body could not be interpreted as a serviceability response. */
  malformed: boolean;
  candidates: ParsedHyperlocalRateCandidate[];
  rawEntries: unknown[];
  providerMessage: string | null;
};

function malformedResult(): ShiprocketHyperlocalParseResult {
  return {
    success: false,
    malformed: true,
    candidates: [],
    rawEntries: [],
    providerMessage: null,
  };
}

export function parseShiprocketHyperlocalServiceability(
  body: unknown,
): ShiprocketHyperlocalParseResult {
  const parsed = shiprocketHyperlocalServiceabilityResponseSchema.safeParse(body);
  if (!parsed.success) {
    return malformedResult();
  }

  const { status, message, data } = parsed.data;

  if (isExplicitStatusFalse(status)) {
    return {
      success: true,
      malformed: false,
      candidates: [],
      rawEntries: data ?? [],
      providerMessage: typeof message === "string" ? message : null,
    };
  }

  if (!isExplicitStatusTrue(status)) {
    if (Array.isArray(data)) {
      // Some responses may omit status but include data[].
    } else {
      return malformedResult();
    }
  }

  const entries = data ?? [];
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

  return {
    success: true,
    malformed: false,
    candidates,
    rawEntries: entries,
    providerMessage: typeof message === "string" ? message : null,
  };
}
