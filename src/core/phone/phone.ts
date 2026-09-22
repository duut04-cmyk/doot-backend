import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";
import type { PhoneNumberValue, PhoneResponse, StoredPhone } from "./phone.types.js";

const INVALID_PHONE_MESSAGE = "Invalid phone number";

export function normalizeCountryCode(countryCode: string): string {
  const trimmed = countryCode.trim();
  if (!trimmed) {
    throw new AppError(INVALID_PHONE_MESSAGE, {
      statusCode: 400,
      code: ErrorCodes.VALIDATION_ERROR,
    });
  }
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

export function normalizeNationalNumber(number: string): string {
  return number.replace(/\D/g, "");
}

export function toE164(countryCode: string, number: string): string {
  return parseAndValidatePhone(countryCode, number).e164;
}

export function parseAndValidatePhone(
  countryCode: string,
  number: string,
): PhoneNumberValue {
  const normalizedCountryCode = normalizeCountryCode(countryCode);
  const nationalNumber = normalizeNationalNumber(number);

  if (!nationalNumber) {
    throw new AppError(INVALID_PHONE_MESSAGE, {
      statusCode: 400,
      code: ErrorCodes.VALIDATION_ERROR,
    });
  }

  const parsed = parsePhoneNumberFromString(
    `${normalizedCountryCode}${nationalNumber}`,
  );

  if (!parsed || !parsed.isValid()) {
    throw new AppError(INVALID_PHONE_MESSAGE, {
      statusCode: 400,
      code: ErrorCodes.VALIDATION_ERROR,
    });
  }

  const derivedCountryCode = `+${parsed.countryCallingCode}`;
  const derivedNationalNumber = parsed.nationalNumber;

  if (
    derivedCountryCode !== normalizedCountryCode ||
    derivedNationalNumber !== nationalNumber
  ) {
    throw new AppError(INVALID_PHONE_MESSAGE, {
      statusCode: 400,
      code: ErrorCodes.VALIDATION_ERROR,
    });
  }

  return {
    countryCode: derivedCountryCode,
    number: derivedNationalNumber,
    e164: parsed.format("E.164"),
  };
}

export function tryParseAndValidatePhone(
  countryCode: string,
  number: string,
): PhoneNumberValue | null {
  try {
    return parseAndValidatePhone(countryCode, number);
  } catch (error) {
    if (error instanceof AppError && error.code === ErrorCodes.VALIDATION_ERROR) {
      return null;
    }
    throw error;
  }
}

export function toStoredPhone(value: PhoneNumberValue): StoredPhone {
  return {
    countryCode: value.countryCode,
    number: value.number,
  };
}

export function toPhoneResponse(
  countryCode: string | null | undefined,
  number: string | null | undefined,
): PhoneResponse | null {
  if (!countryCode || !number) {
    return null;
  }

  return tryParseAndValidatePhone(countryCode, number);
}

export function phoneFromE164(
  e164: string,
  defaultCountry?: CountryCode,
): PhoneNumberValue | null {
  const trimmed = e164.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (!parsed || !parsed.isValid()) {
    return null;
  }

  return {
    countryCode: `+${parsed.countryCallingCode}`,
    number: parsed.nationalNumber,
    e164: parsed.format("E.164"),
  };
}

/** Parse provider-supplied digit strings (e.g. `919876543210`). */
export function phoneFromProviderDigits(
  digits: string,
  defaultCountry: CountryCode = "IN",
): PhoneNumberValue | null {
  const normalized = digits.replace(/\D/g, "");
  if (!normalized) {
    return null;
  }

  const withPlus = normalized.startsWith("+") ? normalized : `+${normalized}`;
  return phoneFromE164(withPlus, defaultCountry);
}

export function isCompleteStoredPhone(
  countryCode: string | null | undefined,
  number: string | null | undefined,
): countryCode is string {
  return Boolean(countryCode && number);
}

/** Normalize loose Indian phone input for MSG91 (`919876543210`, no plus prefix). */
export function normalizePhoneForMsg91(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new AppError(INVALID_PHONE_MESSAGE, {
      statusCode: 400,
      code: ErrorCodes.INVALID_PHONE,
    });
  }

  const candidates = [
    trimmed.startsWith("+") ? trimmed : `+${trimmed}`,
    `+${trimmed.replace(/\D/g, "")}`,
  ];

  for (const candidate of candidates) {
    const parsed = phoneFromE164(candidate, "IN");
    if (parsed) {
      return parsed.e164.replace(/^\+/, "");
    }
  }

  const digits = trimmed.replace(/\D/g, "");
  const fromProvider = phoneFromProviderDigits(digits, "IN");
  if (fromProvider) {
    return fromProvider.e164.replace(/^\+/, "");
  }

  const national = tryParseAndValidatePhone("+91", digits);
  if (national) {
    return national.e164.replace(/^\+/, "");
  }

  throw new AppError(INVALID_PHONE_MESSAGE, {
    statusCode: 400,
    code: ErrorCodes.INVALID_PHONE,
  });
}
