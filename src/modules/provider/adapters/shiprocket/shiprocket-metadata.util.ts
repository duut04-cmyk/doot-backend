import { ProviderAdapterError } from "../../contracts/provider-error.js";
import { SHIPROCKET_PROVIDER_CODE } from "./shiprocket.constants.js";

export function resolveShiprocketCourierId(input: {
  providerMetadata?: Record<string, unknown> | null;
  providerQuoteId?: string | null;
}): number | null {
  const rate = input.providerMetadata?.shiprocketHyperlocalRate;
  if (rate && typeof rate === "object") {
    const row = rate as Record<string, unknown>;
    const candidates = [row.courier_id, row.courier_company_id];
    for (const value of candidates) {
      const parsed = parsePositiveInt(value);
      if (parsed != null) {
        return parsed;
      }
    }
  }

  if (input.providerQuoteId && /^\d+$/.test(input.providerQuoteId)) {
    return Number.parseInt(input.providerQuoteId, 10);
  }

  return null;
}

export function requireShiprocketCourierId(input: {
  providerMetadata?: Record<string, unknown> | null;
  providerQuoteId?: string | null;
}): number {
  const courierId = resolveShiprocketCourierId(input);
  if (courierId == null) {
    throw new ProviderAdapterError({
      providerCode: SHIPROCKET_PROVIDER_CODE,
      operation: "createBooking",
      category: "PROVIDER_VALIDATION_ERROR",
      safeMessage:
        "Shiprocket courier id could not be determined from the selected hyperlocal rate.",
      retryable: false,
    });
  }
  return courierId;
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return null;
}

export function digitsOnlyPhone(countryCode: string, number: string): string {
  const combined = `${countryCode}${number}`.replace(/\D/g, "");
  return combined.slice(-10) || combined;
}
