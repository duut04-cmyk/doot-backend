export type SmsTemplateType = "ACCOUNT_OTP" | "PICKUP_OTP" | "DELIVERY_OTP";

export type SmsTemplateDefinition = {
  type: SmsTemplateType;
  /** Application-side message definition (DLT-approved template required in MSG91). */
  message: string;
};

export const SMS_TEMPLATES: Record<SmsTemplateType, SmsTemplateDefinition> = {
  ACCOUNT_OTP: {
    type: "ACCOUNT_OTP",
    message:
      "Your DOOT verification OTP is {{otp}}. It is valid for 10 minutes. Do not share this OTP with anyone.",
  },
  PICKUP_OTP: {
    type: "PICKUP_OTP",
    message:
      "Your DOOT pickup OTP is {{otp}}. Share this OTP with the driver to confirm pickup.",
  },
  DELIVERY_OTP: {
    type: "DELIVERY_OTP",
    message:
      "Your DOOT delivery OTP is {{otp}}. Share this OTP with the driver to confirm delivery.",
  },
};

export function renderSmsTemplateMessage(
  type: SmsTemplateType,
  variables: Record<string, string>,
): string {
  let message = SMS_TEMPLATES[type].message;
  for (const [key, value] of Object.entries(variables)) {
    message = message.replaceAll(`{{${key}}}`, value);
  }
  return message;
}
