import { z } from "zod";

export const bookingQuoteMaxAgeSecondsSchema = z.coerce.number().int().positive();

export const bookingPriceTolerancePercentSchema = z.coerce.number().min(0).max(100);

export const platformServiceFeePercentSchema = z.coerce.number().int().min(0).max(100);

export function parseStoredBookingQuoteMaxAgeSeconds(value: number): number | null {
  const parsed = bookingQuoteMaxAgeSecondsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseStoredBookingPriceTolerancePercent(value: number): number | null {
  const parsed = bookingPriceTolerancePercentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseStoredPlatformServiceFeePercent(value: number): number | null {
  const parsed = platformServiceFeePercentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
