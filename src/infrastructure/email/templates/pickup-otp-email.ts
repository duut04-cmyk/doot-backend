export type PickupOtpEmailContent = {
  subject: string;
  text: string;
  html: string;
};

export function buildPickupOtpEmail(input: {
  appName: string;
  recipientName: string;
  deliveryReference: string;
  otp: string;
  expiryMinutes: number;
}): PickupOtpEmailContent {
  const { appName, recipientName, deliveryReference, otp, expiryMinutes } = input;
  const subject = `Pickup verification code for ${deliveryReference}`;

  const text = [
    `Hi ${recipientName},`,
    "",
    `Use the verification code below to confirm pickup for delivery ${deliveryReference}:`,
    "",
    otp,
    "",
    `This code expires in ${expiryMinutes} minutes.`,
    "",
    "Share this code with the driver only when your package is ready for pickup.",
    "",
    `If you did not request pickup verification for ${deliveryReference}, contact ${appName} support.`,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f8;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:8px;padding:32px;">
            <tr>
              <td>
                <p style="margin:0 0 8px;font-size:14px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#ea580c;">${escapeHtml(appName)}</p>
                <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">Pickup verification code</h1>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">Hi ${escapeHtml(recipientName)},</p>
                <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">Use the verification code below to confirm pickup for delivery <strong>${escapeHtml(deliveryReference)}</strong>:</p>
                <p style="margin:0 0 20px;font-size:32px;letter-spacing:0.2em;font-weight:700;text-align:center;">${escapeHtml(otp)}</p>
                <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#4b5563;">This code expires in ${expiryMinutes} minutes.</p>
                <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#6b7280;">Share this code with the driver only when your package is ready for pickup.</p>
                <p style="margin:0;font-size:13px;line-height:1.5;color:#6b7280;">If you did not request pickup verification for ${escapeHtml(deliveryReference)}, contact ${escapeHtml(appName)} support.</p>
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
