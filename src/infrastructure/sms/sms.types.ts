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

/** Safe provider failure metadata for logs (no secrets, OTP, or full phone numbers). */
export type SmsSendFailureDiagnostics = {
  provider: "TWILIO";
  failureCategory:
    | "invalid_recipient"
    | "provider_rejection"
    | "provider_server_error"
    | "network_timeout"
    | "unclassified";
  twilioErrorCode?: number;
  httpStatus?: number;
  sanitizedMessage?: string;
  messageSidReturned: boolean;
  /** Last four characters of Twilio Account SID for console cross-check. */
  accountSidSuffix?: string;
};

export type SmsSendResult = {
  outcome: SmsSendOutcome;
  providerRequestId?: string;
  failureDiagnostics?: SmsSendFailureDiagnostics;
};

export type SendPickupOtpSmsInput = {
  recipientMobile: string;
  deliveryReference: string;
  otp: string;
  templateVariables: Omit<OtpSmsTemplateVariables, "otp" | "delivery_reference">;
  correlationId: string;
};

export type SendDeliveryOtpSmsInput = SendPickupOtpSmsInput;
