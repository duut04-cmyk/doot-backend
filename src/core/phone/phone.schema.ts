import { z } from "zod";
import { parseAndValidatePhone } from "./phone.js";
import type { PhoneNumberValue } from "./phone.types.js";

const countryCodeSchema = z
  .string()
  .trim()
  .regex(/^\+\d{1,4}$/, "Country code must start with + followed by digits");

const nationalNumberSchema = z
  .string()
  .trim()
  .min(1, "Phone number is required")
  .max(14, "Phone number is too long");

export const phoneInputSchema = z
  .object({
    countryCode: countryCodeSchema,
    number: nationalNumberSchema,
  })
  .transform((value): PhoneNumberValue =>
    parseAndValidatePhone(value.countryCode, value.number),
  );

function emptyToUndefined(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export const flatOptionalPhoneFieldsSchema = z
  .object({
    phoneCountryCode: z.preprocess(emptyToUndefined, countryCodeSchema.optional()),
    phoneNumber: z.preprocess(emptyToUndefined, nationalNumberSchema.optional()),
  })
  .superRefine((value, ctx) => {
    const hasCountry = value.phoneCountryCode !== undefined;
    const hasNumber = value.phoneNumber !== undefined;
    if (hasCountry !== hasNumber) {
      ctx.addIssue({
        code: "custom",
        message: "Both phoneCountryCode and phoneNumber are required together",
        path: hasCountry ? ["phoneNumber"] : ["phoneCountryCode"],
      });
    }
  })
  .transform((value) => {
    if (!value.phoneCountryCode || !value.phoneNumber) {
      return null;
    }
    return parseAndValidatePhone(value.phoneCountryCode, value.phoneNumber);
  });

export type PhoneInput = z.infer<typeof phoneInputSchema>;
