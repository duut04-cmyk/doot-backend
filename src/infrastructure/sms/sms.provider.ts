import type { SmsSendMessageInput, SmsSendResult } from "./sms.types.js";

export interface SmsProvider {
  readonly name: string;
  sendMessage(input: SmsSendMessageInput): Promise<SmsSendResult>;
}
