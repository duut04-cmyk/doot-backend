import { env } from "../../config/env.js";
import { normalizePhoneForMsg91 } from "../../core/phone/phone.js";

/**
 * Dev/test only: send operational OTP SMS to a fixed verified handset (e.g. Twilio trial).
 * Never applied in production.
 */
export function resolveOperationalSmsRecipientMobile(recipientMobile: string): {
  recipientMobile: string;
  overrideApplied: boolean;
} {
  if (env.NODE_ENV === "production" || !env.SMS_OTP_RECIPIENT_OVERRIDE) {
    return { recipientMobile, overrideApplied: false };
  }

  try {
    return {
      recipientMobile: normalizePhoneForMsg91(env.SMS_OTP_RECIPIENT_OVERRIDE),
      overrideApplied: true,
    };
  } catch {
    return { recipientMobile, overrideApplied: false };
  }
}
