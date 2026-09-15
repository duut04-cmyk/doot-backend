export type PasswordResetOtpEmailContent = {
  subject: string;
  text: string;
  html: string;
};

export function buildPasswordResetOtpEmail(input: {
  appName: string;
  recipientName: string;
  otp: string;
  expiryMinutes: number;
}): PasswordResetOtpEmailContent {
  const { appName, recipientName, otp, expiryMinutes } = input;
  const subject = `Reset your ${appName} password`;

  const text = [
    `Hi ${recipientName},`,
    "",
    `Use the verification code below to reset your ${appName} password:`,
    "",
    otp,
    "",
    `This code expires in ${expiryMinutes} minutes.`,
    "",
    "If you did not request a password reset, you can safely ignore this email.",
    "For your security, the code can only be used once.",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${subject}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f8;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:8px;padding:32px;">
            <tr>
              <td>
                <p style="margin:0 0 8px;font-size:14px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#ea580c;">${escapeHtml(appName)}</p>
                <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">Reset your ${escapeHtml(appName)} password</h1>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">Hi ${escapeHtml(recipientName)},</p>
                <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">Use the verification code below to reset your ${escapeHtml(appName)} password:</p>
                <p style="margin:0 0 20px;font-size:32px;letter-spacing:0.2em;font-weight:700;text-align:center;">${escapeHtml(otp)}</p>
                <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#4b5563;">This code expires in ${expiryMinutes} minutes.</p>
                <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#6b7280;">If you did not request a password reset, you can safely ignore this email.</p>
                <p style="margin:0;font-size:13px;line-height:1.5;color:#6b7280;">For your security, the code can only be used once.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
