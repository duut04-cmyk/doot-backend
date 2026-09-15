import { describe, expect, it } from "vitest";
import { AppError } from "../src/core/errors/app-error.js";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import {
  parseAndValidatePhone,
  phoneFromE164,
  phoneFromProviderDigits,
  toE164,
  toPhoneResponse,
  tryParseAndValidatePhone,
} from "../src/core/phone/phone.js";

describe("phone utilities", () => {
  it("validates and derives E.164 for India", () => {
    const value = parseAndValidatePhone("+91", "9876543210");
    expect(value).toEqual({
      countryCode: "+91",
      number: "9876543210",
      e164: "+919876543210",
    });
    expect(toE164("+91", "9876543210")).toBe("+919876543210");
  });

  it("validates US and UK numbers", () => {
    expect(parseAndValidatePhone("+1", "4155552671")).toMatchObject({
      countryCode: "+1",
      e164: "+14155552671",
    });
    expect(parseAndValidatePhone("+44", "7911123456")).toMatchObject({
      countryCode: "+44",
      e164: "+447911123456",
    });
  });

  it("rejects invalid numbers", () => {
    expect(() => parseAndValidatePhone("+91", "123")).toThrow(AppError);
    expect(tryParseAndValidatePhone("+91", "123")).toBeNull();
    expect(() => parseAndValidatePhone("+91", "")).toThrow(
      expect.objectContaining({ code: ErrorCodes.VALIDATION_ERROR }),
    );
  });

  it("rejects mismatched country code and national number", () => {
    expect(() => parseAndValidatePhone("+1", "9876543210")).toThrow(AppError);
  });

  it("returns null for incomplete stored phone fields", () => {
    expect(toPhoneResponse(null, "9876543210")).toBeNull();
    expect(toPhoneResponse("+91", null)).toBeNull();
    expect(toPhoneResponse("+91", "9876543210")).toMatchObject({
      e164: "+919876543210",
    });
  });

  it("parses E.164 strings", () => {
    expect(phoneFromE164("+919876543210")).toEqual({
      countryCode: "+91",
      number: "9876543210",
      e164: "+919876543210",
    });
    expect(phoneFromE164("")).toBeNull();
    expect(phoneFromE164("invalid")).toBeNull();
  });

  it("parses provider digit strings", () => {
    expect(phoneFromProviderDigits("919876543210")).toMatchObject({
      countryCode: "+91",
      number: "9876543210",
      e164: "+919876543210",
    });
    expect(phoneFromProviderDigits("")).toBeNull();
  });

  it("normalizes country codes without plus prefix", () => {
    expect(parseAndValidatePhone("91", "9876543210").countryCode).toBe("+91");
  });
});
