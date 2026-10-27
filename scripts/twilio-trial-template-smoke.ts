#!/usr/bin/env tsx
/**
 * Opt-in Twilio trial template connectivity test (isolated from Doot OTP flows).
 *
 * Trial accounts require Message `body` to be a predefined template id (not custom OTP text).
 * @see https://www.twilio.com/docs/usage/trials/try-out-sms
 *
 * Required: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER,
 * TWILIO_TRIAL_TEST_TO (verified trial handset), TWILIO_TRIAL_TEMPLATE (allowlisted id).
 *
 * A successful run does not prove Doot operational pickup/delivery OTP SMS works on trial.
 */
import { config as loadDotenv } from "dotenv";
import twilio from "twilio";
import {
  buildValidationFailureSummary,
  executeTwilioTrialTemplateSmoke,
  validateTwilioTrialSmokeEnv,
} from "./lib/twilio-trial-template-smoke.lib.js";

loadDotenv({ override: false });

async function main() {
  const validation = validateTwilioTrialSmokeEnv({
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    TWILIO_FROM_NUMBER: process.env.TWILIO_FROM_NUMBER,
    TWILIO_TRIAL_TEST_TO: process.env.TWILIO_TRIAL_TEST_TO,
    TWILIO_TRIAL_TEMPLATE: process.env.TWILIO_TRIAL_TEMPLATE,
  });

  if (!validation.ok) {
    console.log(
      JSON.stringify(buildValidationFailureSummary(validation.reason), null, 2),
    );
    process.exitCode = 1;
    return;
  }

  const { config } = validation;
  const client = twilio(config.accountSid, config.authToken);

  const summary = await executeTwilioTrialTemplateSmoke(config, (input) =>
    client.messages.create(input),
  );

  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

void main();
