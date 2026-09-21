export type SmsNotificationType = "ACCOUNT_OTP" | "PICKUP_OTP" | "DELIVERY_OTP";

export type OtpSmsTemplateVariables = {
  otp: string;
  delivery_reference: string;
  driver_name: string;
  vehicle_type: string;
  vehicle_number: string;
  driver_phone_masked: string;
  event_type: "PICKUP" | "DELIVERY";
};

export type SmsTemplateVariables = Record<string, string>;

export type SmsSendMessageInput = {
  notificationType: SmsNotificationType;
  recipientMobile: string;
  templateVariables: SmsTemplateVariables;
  correlationId: string;
  deliveryReference: string;
};

export type SmsSendOutcome = "ACCEPTED" | "FAILED" | "TIMEOUT" | "UNKNOWN";

export type SmsSendResult = {
  outcome: SmsSendOutcome;
  providerRequestId?: string;
};

export type SendPickupOtpSmsInput = {
  recipientMobile: string;
  deliveryReference: string;
  otp: string;
  templateVariables: Omit<OtpSmsTemplateVariables, "otp" | "delivery_reference">;
  correlationId: string;
};

export type SendDeliveryOtpSmsInput = SendPickupOtpSmsInput;
