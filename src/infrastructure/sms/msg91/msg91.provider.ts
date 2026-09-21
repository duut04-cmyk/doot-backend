import type { SmsProvider } from "../sms.provider.js";
import type {
  SmsSendMessageInput,
  SmsSendOutcome,
  SmsSendResult,
} from "../sms.types.js";
import { Msg91Client, Msg91RequestError } from "./msg91.client.js";
import type { Msg91ClientConfig } from "./msg91.client.js";

export type Msg91ProviderConfig = Msg91ClientConfig & {
  senderId: string;
  accountTemplateId: string;
  pickupTemplateId: string;
  deliveryTemplateId: string;
};

export class Msg91SmsProvider implements SmsProvider {
  readonly name = "MSG91";

  constructor(
    private readonly config: Msg91ProviderConfig,
    private readonly client: Msg91Client = new Msg91Client({
      baseUrl: config.baseUrl,
      authKey: config.authKey,
      timeoutMs: config.timeoutMs,
    }),
  ) {}

  async sendMessage(input: SmsSendMessageInput): Promise<SmsSendResult> {
    const flowId = resolveTemplateId(input.notificationType, this.config);

    try {
      const response = await this.client.sendFlow(
        {
          flow_id: flowId,
          sender: this.config.senderId,
          recipients: [
            {
              mobiles: input.recipientMobile,
              ...input.templateVariables,
            },
          ],
        },
        input.correlationId,
      );

      return {
        outcome: normalizeAcceptedOutcome(response.type),
        providerRequestId: response.request_id ?? response.requestId,
      };
    } catch (error) {
      if (error instanceof Msg91RequestError) {
        return {
          outcome:
            error.statusCode === 408
              ? "TIMEOUT"
              : error.statusCode >= 500
                ? "UNKNOWN"
                : "FAILED",
        };
      }

      return { outcome: "UNKNOWN" };
    }
  }
}

function resolveTemplateId(
  notificationType: SmsSendMessageInput["notificationType"],
  config: Msg91ProviderConfig,
): string {
  switch (notificationType) {
    case "ACCOUNT_OTP":
      return config.accountTemplateId;
    case "PICKUP_OTP":
      return config.pickupTemplateId;
    case "DELIVERY_OTP":
      return config.deliveryTemplateId;
  }
}

function normalizeAcceptedOutcome(type: string | undefined): SmsSendOutcome {
  if (!type) {
    return "ACCEPTED";
  }

  const normalized = type.toLowerCase();
  if (normalized.includes("success")) {
    return "ACCEPTED";
  }

  if (normalized.includes("error") || normalized.includes("fail")) {
    return "FAILED";
  }

  return "UNKNOWN";
}
