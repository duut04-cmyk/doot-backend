import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  buildValidationFailureSummary,
  executeTwilioTrialTemplateSmoke,
  maskMessageSidSuffix,
  maskPhoneForSmokeLog,
  TWILIO_TRIAL_TEMPLATE_ALLOWLIST,
  validateTwilioTrialSmokeEnv,
} from "../scripts/lib/twilio-trial-template-smoke.lib.js";

const validEnv = {
  TWILIO_ACCOUNT_SID: "AC00000000000000000000000000000001",
  TWILIO_AUTH_TOKEN: "secret-token",
  TWILIO_FROM_NUMBER: "+15551234567",
  TWILIO_TRIAL_TEST_TO: "+14155550123",
  TWILIO_TRIAL_TEMPLATE: "sms_2fa",
} as const;

describe("twilio-trial-template-smoke.lib", () => {
  it("rejects missing credentials without calling Twilio", async () => {
    const result = validateTwilioTrialSmokeEnv({
      ...validEnv,
      TWILIO_AUTH_TOKEN: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("MISSING_TWILIO_CREDENTIALS");
    }

    const create = vi.fn();
    if (result.ok) {
      await executeTwilioTrialTemplateSmoke(result.config, create);
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects missing destination and template", () => {
    expect(
      validateTwilioTrialSmokeEnv({ ...validEnv, TWILIO_TRIAL_TEST_TO: "" }).ok,
    ).toBe(false);
    expect(
      validateTwilioTrialSmokeEnv({ ...validEnv, TWILIO_TRIAL_TEMPLATE: "" }).ok,
    ).toBe(false);
  });

  it("rejects unsupported templates", () => {
    const result = validateTwilioTrialSmokeEnv({
      ...validEnv,
      TWILIO_TRIAL_TEMPLATE: "sms_marketing_promotions",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("UNSUPPORTED_TRIAL_TEMPLATE");
    }
  });

  it("accepts only the documented allowlist", () => {
    for (const template of TWILIO_TRIAL_TEMPLATE_ALLOWLIST) {
      const result = validateTwilioTrialSmokeEnv({
        ...validEnv,
        TWILIO_TRIAL_TEMPLATE: template,
      });
      expect(result.ok).toBe(true);
    }
  });

  it("masks destination and message SID suffix without exposing full values", () => {
    expect(maskPhoneForSmokeLog("+14155550123")).toBe("******0123");
    expect(maskPhoneForSmokeLog("+14155550123")).not.toContain("415555");
    expect(maskMessageSidSuffix("SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe("aaaa");
    expect(maskMessageSidSuffix("SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).not.toMatch(
      /^SM/,
    );
  });

  it("performs exactly one API call on success with template as body", async () => {
    const validation = validateTwilioTrialSmokeEnv(validEnv);
    expect(validation.ok).toBe(true);
    if (!validation.ok) {
      return;
    }

    const create = vi.fn(async () => ({ sid: "SM1234567890abcdef1234567890abcd" }));
    const summary = await executeTwilioTrialTemplateSmoke(validation.config, create);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      to: "+14155550123",
      from: "+15551234567",
      body: "sms_2fa",
    });
    expect(summary.ok).toBe(true);
    expect(summary.messageSidReturned).toBe(true);
    expect(summary.messageSidSuffix).toBe("abcd");
    expect(JSON.stringify(summary)).not.toContain("secret-token");
    expect(JSON.stringify(summary)).not.toContain("+14155550123");
  });

  it("does not retry on failure and surfaces sanitized Twilio error metadata", async () => {
    const validation = validateTwilioTrialSmokeEnv(validEnv);
    expect(validation.ok).toBe(true);
    if (!validation.ok) {
      return;
    }

    const create = vi.fn(async () => {
      throw Object.assign(new Error("Unable to create record"), {
        status: 400,
        code: 21608,
        message: "The number +14155550123 is unverified.",
      });
    });

    const summary = await executeTwilioTrialTemplateSmoke(validation.config, create);
    expect(create).toHaveBeenCalledTimes(1);
    expect(summary.ok).toBe(false);
    expect(summary.twilioErrorCode).toBe(21608);
    expect(summary.httpStatus).toBe(400);
    expect(summary.failureCategory).toBe("provider_rejection");
    expect(summary.sanitizedMessage).toContain("[redacted-phone]");
    expect(summary.sanitizedMessage).not.toContain("4155550123");
  });

  it("builds validation failure summaries without secrets", () => {
    const summary = buildValidationFailureSummary("MISSING_TRIAL_DESTINATION");
    expect(summary.ok).toBe(false);
    expect(summary.messageSidReturned).toBe(false);
    expect(JSON.stringify(summary)).not.toContain("token");
  });

  it("does not import operational OTP or SMS service modules", () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const libPath = join(testDir, "../scripts/lib/twilio-trial-template-smoke.lib.ts");
    const source = readFileSync(libPath, "utf8");
    expect(source).not.toMatch(/otp\.service|sms\.service|pickup-otp|delivery-otp/);
    expect(source).not.toMatch(/SmsService|OtpService/);
  });
});
