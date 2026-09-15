import { Resend } from "resend";
import { env } from "../../config/env.js";

let resendClient: Resend | null = null;

export type ResendSendInput = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
};

/**
 * Provider-specific Resend client. Keep SDK usage out of services/controllers.
 */
export function getResendClient(): Resend {
  if (!env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  if (!resendClient) {
    resendClient = new Resend(env.RESEND_API_KEY);
  }

  return resendClient;
}

export async function sendWithResend(input: ResendSendInput): Promise<void> {
  const client = getResendClient();
  const result = await client.emails.send({
    from: input.from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });

  if (result.error) {
    throw new Error(result.error.message || "Resend email send failed");
  }
}

/** Test helper to clear cached client between suites. */
export function resetResendClient(): void {
  resendClient = null;
}
