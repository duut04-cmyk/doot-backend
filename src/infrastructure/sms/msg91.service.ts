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
import { normalizePhoneForMsg91 } from "../../core/phone/phone.js";
import { Msg91SmsProvider } from "./msg91/msg91.provider.js";
import type { SmsProvider } from "./sms.provider.js";
import type { SmsNotificationType, SmsSendOutcome } from "./sms.types.js";
import type { SmsTemplateType } from "./templates/sms.templates.js";
import { SMS_TEMPLATES } from "./templates/sms.templates.js";

export type SendSmsInput = {
  phone: string;
  type: SmsTemplateType;
  variables: Record<string, string>;
  correlationId?: string;
};

export type SendOtpInput = {
  phone: string;
  type: SmsTemplateType;
  otp: string;
  variables?: Record<string, string>;
  correlationId?: string;
};

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

function toNotificationType(type: SmsTemplateType): SmsNotificationType {
  return type;
}

function resolveTemplateId(type: SmsTemplateType): string | undefined {
  switch (type) {
    case "ACCOUNT_OTP":
      return getMsg91AccountTemplateId();
    case "PICKUP_OTP":
      return getMsg91PickupTemplateId();
    case "DELIVERY_OTP":
      return getMsg91DeliveryTemplateId();
  }
}

export class Msg91Service {
  constructor(private readonly provider: SmsProvider = createDefaultProvider()) {}

  isEnabled(): boolean {
    return env.MSG91_ENABLED === true && isMsg91Configured();
  }

  assertReady(type: SmsTemplateType): void {
    if (!env.MSG91_ENABLED) {
      throw new AppError("MSG91 SMS service is disabled.", {
        statusCode: 503,
        code: ErrorCodes.SMS_NOT_CONFIGURED,
      });
    }

    if (
      !env.MSG91_AUTH_KEY ||
      !env.MSG91_SENDER_ID ||
      !env.MSG91_API_BASE_URL ||
      !resolveTemplateId(type)
    ) {
      throw new AppError("SMS service is not configured.", {
        statusCode: 503,
        code: ErrorCodes.SMS_NOT_CONFIGURED,
      });
    }
  }

  async sendSms(input: SendSmsInput): Promise<void> {
    this.assertReady(input.type);

    const recipientMobile = normalizePhoneForMsg91(input.phone);
    const correlationId = input.correlationId ?? "sms-send";

    const result = await this.provider.sendMessage({
      notificationType: toNotificationType(input.type),
      recipientMobile,
      correlationId,
      deliveryReference: input.variables.delivery_reference ?? "TEST",
      templateVariables: input.variables,
    });

    logger.info(
      {
        correlationId,
        provider: this.provider.name,
        notificationType: input.type,
        templateKey: SMS_TEMPLATES[input.type].type,
        outcome: result.outcome,
        providerRequestId: result.providerRequestId,
      },
      "msg91_sms_attempted",
    );

    if (result.outcome !== "ACCEPTED") {
      throw new AppError("Unable to send SMS.", {
        statusCode: 503,
        code: ErrorCodes.SMS_DELIVERY_FAILED,
      });
    }
  }

  async sendOtp(input: SendOtpInput): Promise<void> {
    await this.sendSms({
      phone: input.phone,
      type: input.type,
      variables: {
        ...(input.variables ?? {}),
        otp: input.otp,
      },
      correlationId: input.correlationId,
    });
  }

  async sendAccountOtp(
    phone: string,
    otp: string,
    correlationId?: string,
  ): Promise<void> {
    await this.sendOtp({ phone, type: "ACCOUNT_OTP", otp, correlationId });
  }

  async sendPickupOtp(
    phone: string,
    otp: string,
    correlationId?: string,
  ): Promise<void> {
    await this.sendOtp({ phone, type: "PICKUP_OTP", otp, correlationId });
  }

  async sendDeliveryOtp(
    phone: string,
    otp: string,
    correlationId?: string,
  ): Promise<void> {
    await this.sendOtp({ phone, type: "DELIVERY_OTP", otp, correlationId });
  }
}

export const msg91Service = new Msg91Service();
