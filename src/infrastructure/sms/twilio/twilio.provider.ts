import twilio from "twilio";
import { phoneFromProviderDigits } from "../../../core/phone/phone.js";
import type { SmsProvider } from "../sms.provider.js";
import type {
  SmsNotificationType,
  SmsSendMessageInput,
  SmsSendResult,
} from "../sms.types.js";
import {
  renderSmsTemplateMessage,
  type SmsTemplateType,
} from "../templates/sms.templates.js";
import {
  buildInvalidRecipientDiagnostics,
  buildTwilioApiFailureDiagnostics,
  mapTwilioErrorToOutcome,
} from "./twilio-error-diagnostics.js";

export type TwilioProviderConfig = {
  accountSid: string;
  authToken: string;
  fromNumber: string;
};

export type TwilioMessagesClient = {
  create(input: {
    to: string;
    from: string;
    body: string;
  }): Promise<{ sid: string; status?: string }>;
};

export class TwilioSmsProvider implements SmsProvider {
  readonly name = "TWILIO";

  constructor(
    private readonly config: TwilioProviderConfig,
    private readonly messages: TwilioMessagesClient,
  ) {}

  static fromEnv(config: TwilioProviderConfig): TwilioSmsProvider {
    const client = twilio(config.accountSid, config.authToken);
    return new TwilioSmsProvider(config, {
      create: (input) => client.messages.create(input),
    });
  }

  async sendMessage(input: SmsSendMessageInput): Promise<SmsSendResult> {
    const to = resolveTwilioToAddress(input.recipientMobile);
    if (!to) {
      return {
        outcome: "FAILED",
        failureDiagnostics: buildInvalidRecipientDiagnostics(this.config.accountSid),
      };
    }

    const templateType = notificationToTemplateType(input.notificationType);
    const body = renderSmsTemplateMessage(templateType, {
      otp: input.templateVariables.otp ?? "",
    });

    try {
      const message = await this.messages.create({
        to,
        from: this.config.fromNumber,
        body,
      });

      return {
        outcome: "ACCEPTED",
        providerRequestId: message.sid,
      };
    } catch (error) {
      const outcome = mapTwilioErrorToOutcome(error);
      return {
        outcome,
        failureDiagnostics: buildTwilioApiFailureDiagnostics(
          error,
          outcome,
          this.config.accountSid,
        ),
      };
    }
  }
}

function notificationToTemplateType(
  notificationType: SmsNotificationType,
): SmsTemplateType {
  return notificationType;
}

function resolveTwilioToAddress(recipientMobile: string): string | null {
  const parsed = phoneFromProviderDigits(recipientMobile);
  return parsed?.e164 ?? null;
}
