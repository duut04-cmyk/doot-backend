import { z } from "zod";
import {
  bookingPriceTolerancePercentSchema,
  bookingQuoteMaxAgeSecondsSchema,
  platformServiceFeePercentSchema,
} from "./runtime-settings.validation.js";

export const patchBookingPoliciesSchema = z
  .object({
    booking: z
      .object({
        quoteMaxAgeSeconds: bookingQuoteMaxAgeSecondsSchema.optional(),
        priceTolerancePercent: bookingPriceTolerancePercentSchema.optional(),
      })
      .strict()
      .optional(),
    pricing: z
      .object({
        platformServiceFeePercent: platformServiceFeePercentSchema.optional(),
      })
      .strict()
      .optional(),
    expectedVersions: z
      .object({
        quoteMaxAgeSeconds: z.number().int().nonnegative(),
        priceTolerancePercent: z.number().int().nonnegative(),
        platformServiceFeePercent: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const booking = data.booking;
    const pricing = data.pricing;
    const hasBookingField =
      booking?.quoteMaxAgeSeconds !== undefined ||
      booking?.priceTolerancePercent !== undefined;
    const hasPricingField = pricing?.platformServiceFeePercent !== undefined;
    if (!hasBookingField && !hasPricingField) {
      ctx.addIssue({
        code: "custom",
        message: "At least one allowlisted runtime policy field must be provided.",
        path: ["booking"],
      });
    }
  });

export type PatchBookingPoliciesInput = z.infer<typeof patchBookingPoliciesSchema>;
