import { config as loadDotenv } from "dotenv";
loadDotenv({ override: false });
import { env, isOperationalSmsEnabled, isTwilioConfigured } from "../src/config/env.js";
import { resolveOperationalSmsProvider } from "../src/infrastructure/sms/sms-provider.factory.js";

console.log(
  JSON.stringify({
    SMS_PROVIDER: env.SMS_PROVIDER,
    MSG91_ENABLED: env.MSG91_ENABLED,
    twilioConfigured: isTwilioConfigured(),
    hasAccountSid: Boolean(env.TWILIO_ACCOUNT_SID),
    hasAuthToken: Boolean(env.TWILIO_AUTH_TOKEN),
    hasFromNumber: Boolean(env.TWILIO_FROM_NUMBER),
    operationalSmsEnabled: isOperationalSmsEnabled(),
    providerName: resolveOperationalSmsProvider().name,
  }),
);
