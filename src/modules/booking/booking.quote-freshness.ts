import type { QuoteSnapshot } from "./booking.types.js";

export function resolveQuoteTimestamp(input: {
  quoteSnapshot: QuoteSnapshot;
  orchestrationCompletedAt: Date | null;
  optionCreatedAt: Date;
}): Date {
  if (input.quoteSnapshot.quotedAt) {
    return new Date(input.quoteSnapshot.quotedAt);
  }
  if (input.orchestrationCompletedAt) {
    return input.orchestrationCompletedAt;
  }
  return input.optionCreatedAt;
}

export function isQuoteStale(quotedAt: Date, maxAgeSeconds: number): boolean {
  const ageMs = Date.now() - quotedAt.getTime();
  return ageMs > maxAgeSeconds * 1000;
}

export function hasMaterialPriceChange(input: {
  originalAmount: number;
  newAmount: number;
  tolerancePercent: number;
}): boolean {
  if (input.originalAmount <= 0) {
    return input.newAmount !== input.originalAmount;
  }
  const diff = Math.abs(input.newAmount - input.originalAmount);
  const threshold = input.originalAmount * (input.tolerancePercent / 100);
  return diff > threshold;
}
