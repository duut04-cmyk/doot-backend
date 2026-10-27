import { describe, expect, it } from "vitest";
import { AppError } from "../src/core/errors/app-error.js";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import {
  parseSmsSendOutcome,
  readSmsOutcomeFromError,
  shouldInvalidateOtpAfterSmsFailure,
} from "../src/infrastructure/sms/sms-outcome.js";

describe("sms-outcome", () => {
  it("parses known outcomes and treats unknown strings as UNKNOWN", () => {
    expect(parseSmsSendOutcome("FAILED")).toBe("FAILED");
    expect(parseSmsSendOutcome("TIMEOUT")).toBe("TIMEOUT");
    expect(parseSmsSendOutcome("NOT_A_REAL_OUTCOME")).toBe("UNKNOWN");
    expect(parseSmsSendOutcome(null)).toBe("UNKNOWN");
  });

  it("only FAILED requires OTP invalidation", () => {
    expect(shouldInvalidateOtpAfterSmsFailure("FAILED")).toBe(true);
    expect(shouldInvalidateOtpAfterSmsFailure("TIMEOUT")).toBe(false);
    expect(shouldInvalidateOtpAfterSmsFailure("UNKNOWN")).toBe(false);
    expect(shouldInvalidateOtpAfterSmsFailure("ACCEPTED")).toBe(false);
  });

  it("reads SMS_DELIVERY_FAILED cause with runtime validation", () => {
    const error = new AppError("sms failed", {
      code: ErrorCodes.SMS_DELIVERY_FAILED,
      cause: { smsOutcome: "BOGUS" },
    });
    expect(readSmsOutcomeFromError(error)).toBe("UNKNOWN");
  });

  it("treats missing cause on SMS_DELIVERY_FAILED as UNKNOWN", () => {
    const error = new AppError("sms failed", {
      code: ErrorCodes.SMS_DELIVERY_FAILED,
    });
    expect(readSmsOutcomeFromError(error)).toBe("UNKNOWN");
  });

  it("treats non-SMS AppError as UNKNOWN", () => {
    expect(
      readSmsOutcomeFromError(
        new AppError("nope", { code: ErrorCodes.OTP_NOT_ALLOWED }),
      ),
    ).toBe("UNKNOWN");
  });

  it("treats non-Error throws as UNKNOWN", () => {
    expect(readSmsOutcomeFromError("unexpected")).toBe("UNKNOWN");
  });
});
