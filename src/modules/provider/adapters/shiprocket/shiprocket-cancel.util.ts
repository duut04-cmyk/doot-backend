import type { QuoteSnapshot } from "../../../booking/booking.types.js";
import { resolveShiprocketProviderMetadata } from "../../../booking/booking.quote-snapshot.js";
import { isValidShiprocketOrderId } from "./shiprocket-order-show.parse.js";

/**
 * Shiprocket Passbook / wallet freight credits from provider cancellation are
 * provider-side settlements. Doot customer refunds remain independent (Cashfree via
 * `cancel-refund:{cancellationId}` after delivery reaches CANCELLED).
 */

export function resolveShiprocketNumericOrderIdForCancel(input: {
  providerOrderId: string | null;
  quoteSnapshot: QuoteSnapshot;
}): string | null {
  if (isValidShiprocketOrderId(input.providerOrderId)) {
    return input.providerOrderId.trim();
  }

  const metadata = resolveShiprocketProviderMetadata(input.quoteSnapshot);
  const fromMeta = metadata?.shiprocketOrderId;
  if (typeof fromMeta === "string" && isValidShiprocketOrderId(fromMeta)) {
    return fromMeta.trim();
  }
  if (typeof fromMeta === "number" && Number.isFinite(fromMeta)) {
    const asString = String(fromMeta);
    return isValidShiprocketOrderId(asString) ? asString : null;
  }

  return null;
}

export function parseShiprocketCancelErrorReason(body: unknown): string | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const row = body as Record<string, unknown>;
  for (const key of ["message", "error", "reason"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim().slice(0, 500);
    }
  }
  const errors = row.errors;
  if (Array.isArray(errors)) {
    for (const entry of errors) {
      if (entry && typeof entry === "object") {
        const msg = (entry as Record<string, unknown>).message;
        if (typeof msg === "string" && msg.trim().length > 0) {
          return msg.trim().slice(0, 500);
        }
      }
    }
  }
  return null;
}
