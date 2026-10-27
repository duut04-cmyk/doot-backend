import {
  env,
  getMsg91AccountTemplateId,
  getMsg91DeliveryTemplateId,
  getMsg91PickupTemplateId,
  isMsg91Configured,
  isTwilioConfigured,
} from "../../config/env.js";
import { Msg91SmsProvider } from "./msg91/msg91.provider.js";
import type { SmsProvider } from "./sms.provider.js";
import { TwilioSmsProvider } from "./twilio/twilio.provider.js";

class MockSmsProvider implements SmsProvider {
  readonly name = "MOCK";

  async sendMessage() {
    return { outcome: "ACCEPTED" as const };
  }
}

class NoopSmsProvider implements SmsProvider {
  readonly name = "NOOP";

  async sendMessage() {
    return { outcome: "ACCEPTED" as const };
  }
}

/** Resolves exactly one operational SMS provider from configuration. */
export function resolveOperationalSmsProvider(): SmsProvider {
  switch (env.SMS_PROVIDER) {
    case "mock":
      return new MockSmsProvider();
    case "twilio":
      if (!isTwilioConfigured()) {
        return new NoopSmsProvider();
      }
      return TwilioSmsProvider.fromEnv({
        accountSid: env.TWILIO_ACCOUNT_SID!,
        authToken: env.TWILIO_AUTH_TOKEN!,
        fromNumber: env.TWILIO_FROM_NUMBER!,
      });
    case "msg91":
      if (!isMsg91Configured()) {
        return new NoopSmsProvider();
      }
      return new Msg91SmsProvider({
        baseUrl: env.MSG91_API_BASE_URL!,
        authKey: env.MSG91_AUTH_KEY!,
        timeoutMs: env.MSG91_TIMEOUT_MS,
        senderId: env.MSG91_SENDER_ID!,
        accountTemplateId: getMsg91AccountTemplateId() ?? "unconfigured",
        pickupTemplateId: getMsg91PickupTemplateId()!,
        deliveryTemplateId: getMsg91DeliveryTemplateId()!,
      });
    default:
      return new NoopSmsProvider();
  }
}
