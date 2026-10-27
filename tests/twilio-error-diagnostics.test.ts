import { describe, expect, it } from "vitest";
import {
  buildTwilioApiFailureDiagnostics,
  mapTwilioErrorToOutcome,
  sanitizeTwilioErrorMessage,
  twilioAccountSidSuffix,
} from "../src/infrastructure/sms/twilio/twilio-error-diagnostics.js";

describe("twilio-error-diagnostics", () => {
  it("maps HTTP 4xx to FAILED and preserves Twilio code in diagnostics", () => {
    const error = Object.assign(new Error("Unable to create record"), {
      status: 400,
      code: 21608,
      message: "The number +919876543210 is unverified. Trial accounts cannot send.",
    });

    expect(mapTwilioErrorToOutcome(error)).toBe("FAILED");

    const diagnostics = buildTwilioApiFailureDiagnostics(
      error,
      "FAILED",
      "AC0000000000000000000000000000533c",
    );
    expect(diagnostics.twilioErrorCode).toBe(21608);
    expect(diagnostics.httpStatus).toBe(400);
    expect(diagnostics.failureCategory).toBe("provider_rejection");
    expect(diagnostics.messageSidReturned).toBe(false);
    expect(diagnostics.accountSidSuffix).toBe("533c");
    expect(diagnostics.sanitizedMessage).toContain("[redacted-phone]");
    expect(diagnostics.sanitizedMessage).not.toContain("919876543210");
  });

  it("maps HTTP 5xx to UNKNOWN (not FAILED)", () => {
    const error = Object.assign(new Error("Server error"), {
      status: 503,
      code: 20503,
    });
    expect(mapTwilioErrorToOutcome(error)).toBe("UNKNOWN");
    const diagnostics = buildTwilioApiFailureDiagnostics(error, "UNKNOWN", "ACtest");
    expect(diagnostics.failureCategory).toBe("provider_server_error");
    expect(diagnostics.twilioErrorCode).toBe(20503);
    expect(diagnostics.httpStatus).toBe(503);
  });

  it("maps Twilio REST code without HTTP status to FAILED", () => {
    const error = { code: 21211, message: "Invalid To Phone Number" };
    expect(mapTwilioErrorToOutcome(error)).toBe("FAILED");
  });

  it("maps socket timeouts to TIMEOUT", () => {
    const error = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    expect(mapTwilioErrorToOutcome(error)).toBe("TIMEOUT");
  });

  it("sanitizes long digit runs in messages", () => {
    expect(sanitizeTwilioErrorMessage("OTP 123456 sent to user")).toContain(
      "[redacted-digits]",
    );
  });

  it("derives account SID suffix safely", () => {
    expect(twilioAccountSidSuffix("AC0000000000000000000000000000533c")).toBe("533c");
    expect(twilioAccountSidSuffix("AC")).toBeUndefined();
  });
});
