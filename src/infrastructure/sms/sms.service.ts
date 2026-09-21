import {
  env,
  getMsg91AccountTemplateId,
  getMsg91DeliveryTemplateId,
  getMsg91PickupTemplateId,
  isMsg91Configured,
} from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import { toPhoneResponse } from "../../core/phone/phone.js";
import { Msg91SmsProvider } from "./msg91/msg91.provider.js";
import type { SmsProvider } from "./sms.provider.js";
import type {
  SendDeliveryOtpSmsInput,
  SendPickupOtpSmsInput,
  SmsSendOutcome,
} from "./sms.types.js";

export interface SmsSender {
  isEnabled(): boolean;
  canSendToCustomer(input: {
    phoneCountryCode: string | null;
    phoneNumber: string | null;
  }): boolean;
  sendPickupOtpSms(input: SendPickupOtpSmsInput): Promise<void>;
  sendDeliveryOtpSms(input: SendDeliveryOtpSmsInput): Promise<void>;
}

class NoopSmsProvider implements SmsProvider {
  readonly name = "NOOP";

  async sendMessage(): Promise<{ outcome: SmsSendOutcome }> {
    return { outcome: "ACCEPTED" };
  }
}

function createDefaultProvider(): SmsProvider {
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
}

export class SmsService implements SmsSender {
  constructor(private readonly provider: SmsProvider = createDefaultProvider()) {}

  isEnabled(): boolean {
    return env.MSG91_ENABLED === true && isMsg91Configured();
  }

  canSendToCustomer(input: {
    phoneCountryCode: string | null;
    phoneNumber: string | null;
  }): boolean {
    return Boolean(toPhoneResponse(input.phoneCountryCode, input.phoneNumber));
  }

  async sendPickupOtpSms(input: SendPickupOtpSmsInput): Promise<void> {
    await this.sendOtpSms("PICKUP_OTP", input);
  }

  async sendDeliveryOtpSms(input: SendDeliveryOtpSmsInput): Promise<void> {
    await this.sendOtpSms("DELIVERY_OTP", input);
  }

  private async sendOtpSms(
    notificationType: "PICKUP_OTP" | "DELIVERY_OTP",
    input: SendPickupOtpSmsInput,
  ): Promise<void> {
    if (!this.isEnabled()) {
      throw new AppError("SMS delivery is not configured.", {
        statusCode: 503,
        code: ErrorCodes.SMS_NOT_CONFIGURED,
      });
    }

    const result = await this.provider.sendMessage({
      notificationType,
      recipientMobile: input.recipientMobile,
      correlationId: input.correlationId,
      deliveryReference: input.deliveryReference,
      templateVariables: {
        otp: input.otp,
        delivery_reference: input.deliveryReference,
        ...input.templateVariables,
      },
    });

    logger.info(
      {
        correlationId: input.correlationId,
        provider: this.provider.name,
        notificationType,
        deliveryReference: input.deliveryReference,
        outcome: result.outcome,
        providerRequestId: result.providerRequestId,
      },
      "sms_notification_attempted",
    );

    if (result.outcome !== "ACCEPTED") {
      const label = notificationType === "PICKUP_OTP" ? "pickup" : "delivery";
      throw new AppError(`Unable to send ${label} verification SMS at this time.`, {
        statusCode: 503,
        code: ErrorCodes.SMS_DELIVERY_FAILED,
      });
    }
  }
}

export const smsService = new SmsService();
