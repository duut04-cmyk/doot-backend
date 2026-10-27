import { phoneFromProviderDigits } from "../../src/core/phone/phone.js";
import {
  buildTwilioApiFailureDiagnostics,
  mapTwilioErrorToOutcome,
} from "../../src/infrastructure/sms/twilio/twilio-error-diagnostics.js";

/**
 * Twilio trial SMS: predefined template identifiers passed as the Message `body`.
 * @see https://www.twilio.com/docs/usage/trials/try-out-sms
 */
export const TWILIO_TRIAL_TEMPLATE_ALLOWLIST = [
  "sms_delivery_updates",
  "sms_appointment_reminders",
  "sms_order_confirmation",
  "sms_2fa",
] as const;

export type TwilioTrialTemplateId = (typeof TWILIO_TRIAL_TEMPLATE_ALLOWLIST)[number];

export type TwilioTrialSmokeEnvInput = {
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
  TWILIO_TRIAL_TEST_TO?: string;
  TWILIO_TRIAL_TEMPLATE?: string;
};

export type TwilioTrialSmokeConfig = {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  toE164: string;
  template: TwilioTrialTemplateId;
};

export type TwilioTrialSmokeValidationFailure = {
  ok: false;
  reason:
    | "MISSING_TWILIO_CREDENTIALS"
    | "MISSING_TRIAL_DESTINATION"
    | "MISSING_TRIAL_TEMPLATE"
    | "UNSUPPORTED_TRIAL_TEMPLATE"
    | "INVALID_TRIAL_DESTINATION";
};

export type TwilioTrialSmokeValidationSuccess = {
  ok: true;
  config: TwilioTrialSmokeConfig;
};

export type TwilioTrialSmokeValidationResult =
  TwilioTrialSmokeValidationFailure | TwilioTrialSmokeValidationSuccess;

export type TwilioTrialSmokeSummary = {
  ok: boolean;
  template: string;
  destinationMasked: string;
  messageSidReturned: boolean;
  messageSidSuffix?: string;
  httpStatus?: number;
  twilioErrorCode?: number;
  failureCategory?: string;
  sanitizedMessage?: string;
  reason?: TwilioTrialSmokeValidationFailure["reason"];
};

export type TwilioMessagesCreateFn = (input: {
  to: string;
  from: string;
  body: string;
}) => Promise<{ sid: string }>;

const emptyToUndefined = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export function isAllowedTwilioTrialTemplate(
  value: string,
): value is TwilioTrialTemplateId {
  return (TWILIO_TRIAL_TEMPLATE_ALLOWLIST as readonly string[]).includes(value);
}

export function maskPhoneForSmokeLog(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (digits.length <= 4) {
    return "****";
  }
  return `******${digits.slice(-4)}`;
}

export function maskMessageSidSuffix(sid: string | undefined): string | undefined {
  if (!sid || sid.length < 4) {
    return undefined;
  }
  return sid.slice(-4);
}

export function validateTwilioTrialSmokeEnv(
  input: TwilioTrialSmokeEnvInput,
): TwilioTrialSmokeValidationResult {
  const accountSid = emptyToUndefined(input.TWILIO_ACCOUNT_SID);
  const authToken = emptyToUndefined(input.TWILIO_AUTH_TOKEN);
  const fromNumber = emptyToUndefined(input.TWILIO_FROM_NUMBER);

  if (!accountSid || !authToken || !fromNumber) {
    return { ok: false, reason: "MISSING_TWILIO_CREDENTIALS" };
  }

  const trialToRaw = emptyToUndefined(input.TWILIO_TRIAL_TEST_TO);
  if (!trialToRaw) {
    return { ok: false, reason: "MISSING_TRIAL_DESTINATION" };
  }

  const templateRaw = emptyToUndefined(input.TWILIO_TRIAL_TEMPLATE);
  if (!templateRaw) {
    return { ok: false, reason: "MISSING_TRIAL_TEMPLATE" };
  }

  if (!isAllowedTwilioTrialTemplate(templateRaw)) {
    return { ok: false, reason: "UNSUPPORTED_TRIAL_TEMPLATE" };
  }

  const parsed = phoneFromProviderDigits(trialToRaw.replace(/^\+/, ""));
  if (!parsed?.e164) {
    return { ok: false, reason: "INVALID_TRIAL_DESTINATION" };
  }

  return {
    ok: true,
    config: {
      accountSid,
      authToken,
      fromNumber,
      toE164: parsed.e164,
      template: templateRaw,
    },
  };
}

export function buildValidationFailureSummary(
  reason: TwilioTrialSmokeValidationFailure["reason"],
  template?: string,
  destinationMasked?: string,
): TwilioTrialSmokeSummary {
  return {
    ok: false,
    reason,
    template: template ?? "[not-set]",
    destinationMasked: destinationMasked ?? "[not-set]",
    messageSidReturned: false,
  };
}

/** Exactly one Twilio Messages API create call; no retries. */
export async function executeTwilioTrialTemplateSmoke(
  config: TwilioTrialSmokeConfig,
  messagesCreate: TwilioMessagesCreateFn,
): Promise<TwilioTrialSmokeSummary> {
  const destinationMasked = maskPhoneForSmokeLog(config.toE164);

  try {
    const message = await messagesCreate({
      to: config.toE164,
      from: config.fromNumber,
      body: config.template,
    });

    return {
      ok: true,
      template: config.template,
      destinationMasked,
      messageSidReturned: Boolean(message.sid),
      messageSidSuffix: maskMessageSidSuffix(message.sid),
    };
  } catch (error) {
    const outcome = mapTwilioErrorToOutcome(error);
    const diagnostics = buildTwilioApiFailureDiagnostics(
      error,
      outcome,
      config.accountSid,
    );

    return {
      ok: false,
      template: config.template,
      destinationMasked,
      messageSidReturned: false,
      httpStatus: diagnostics.httpStatus,
      twilioErrorCode: diagnostics.twilioErrorCode,
      failureCategory: diagnostics.failureCategory,
      sanitizedMessage: diagnostics.sanitizedMessage,
    };
  }
}
