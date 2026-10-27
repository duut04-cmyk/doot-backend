import { logger } from "../../config/logger.js";
import { isOperationalSmsEnabled } from "../../config/env.js";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import { toPhoneResponse } from "../../core/phone/phone.js";
import type { SmsDeliveryFailureCause } from "./sms-outcome.js";
import { resolveOperationalSmsRecipientMobile } from "./sms-recipient.js";
import { resolveOperationalSmsProvider } from "./sms-provider.factory.js";
import type { SmsProvider } from "./sms.provider.js";
import type { SendDeliveryOtpSmsInput, SendPickupOtpSmsInput } from "./sms.types.js";

export type { SmsDeliveryFailureCause } from "./sms-outcome.js";

export interface SmsSender {
  isEnabled(): boolean;
  canSendToCustomer(input: {
    phoneCountryCode: string | null;
    phoneNumber: string | null;
  }): boolean;
  sendPickupOtpSms(input: SendPickupOtpSmsInput): Promise<void>;
  sendDeliveryOtpSms(input: SendDeliveryOtpSmsInput): Promise<void>;
}

export class SmsService implements SmsSender {
  constructor(
    private readonly provider: SmsProvider = resolveOperationalSmsProvider(),
  ) {}

  isEnabled(): boolean {
    return isOperationalSmsEnabled();
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

    const { recipientMobile, overrideApplied } = resolveOperationalSmsRecipientMobile(
      input.recipientMobile,
    );

    const result = await this.provider.sendMessage({
      notificationType,
      recipientMobile,
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
        messageSidReturned: Boolean(result.providerRequestId),
        smsRecipientOverrideApplied: overrideApplied,
        ...(result.failureDiagnostics
          ? { smsFailureDiagnostics: result.failureDiagnostics }
          : {}),
      },
      "sms_notification_attempted",
    );

    if (result.outcome !== "ACCEPTED") {
      const label = notificationType === "PICKUP_OTP" ? "pickup" : "delivery";
      throw new AppError(`Unable to send ${label} verification SMS at this time.`, {
        statusCode: 503,
        code: ErrorCodes.SMS_DELIVERY_FAILED,
        cause: { smsOutcome: result.outcome } satisfies SmsDeliveryFailureCause,
      });
    }
  }
}

export const smsService = new SmsService();
