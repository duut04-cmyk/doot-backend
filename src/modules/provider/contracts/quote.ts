import { z } from "zod";
import { moneyAmountSchema } from "./common.js";
import { serviceabilityRequestSchema } from "./serviceability.js";

export const quoteBreakdownSchema = z.object({
  baseAmount: z.number().nonnegative().nullable(),
  distanceCharge: z.number().nonnegative().nullable(),
  surgeAmount: z.number().nonnegative().nullable(),
  taxAmount: z.number().nonnegative().nullable(),
  otherCharges: z.number().nonnegative().nullable(),
  totalAmount: z.number().nonnegative(),
});

export const quoteRequestSchema = serviceabilityRequestSchema.extend({
  serviceCode: z.string().optional(),
});

export const normalizedQuoteSchema = z.object({
  available: z.boolean(),
  amount: moneyAmountSchema.nullable(),
  providerQuoteId: z.string().nullable(),
  estimatedDeliveryAt: z.string().datetime().nullable(),
  estimatedDeliveryMinutes: z.number().int().nonnegative().nullable(),
  breakdown: quoteBreakdownSchema.nullable(),
  quotedAt: z.string().datetime(),
  reason: z.string().nullable(),
});

export type QuoteBreakdown = z.infer<typeof quoteBreakdownSchema>;
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;
export type NormalizedQuote = z.infer<typeof normalizedQuoteSchema>;
