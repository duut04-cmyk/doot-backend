export type PasswordResetEmailContent = {
  subject: string;
  text: string;
  html: string;
};

export function buildPasswordResetEmail(input: {
  appName: string;
  recipientName: string;
  resetUrl: string;
  expiryMinutes: number;
}): PasswordResetEmailContent {
  const { appName, recipientName, resetUrl, expiryMinutes } = input;
  const subject = `Reset your ${appName} password`;

  const text = [
    `Hi ${recipientName},`,
    "",
    `We received a request to reset the password for your ${appName} account.`,
    "",
    "Use the link below to create a new password:",
    resetUrl,
    "",
    `This link expires in ${expiryMinutes} minutes.`,
    "",
    "If you did not request a password reset, you can safely ignore this email.",
    "For your security, the link can only be used once.",
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
                <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">We received a request to reset the password for your ${escapeHtml(appName)} account.</p>
                <p style="margin:0 0 24px;text-align:center;">
                  <a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-size:15px;font-weight:600;">Reset Password</a>
                </p>
                <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#4b5563;">This link expires in ${expiryMinutes} minutes.</p>
                <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#6b7280;">If you did not request a password reset, you can safely ignore this email.</p>
                <p style="margin:0;font-size:13px;line-height:1.5;color:#6b7280;">For your security, the link can only be used once.</p>
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
