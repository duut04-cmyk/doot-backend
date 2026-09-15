import { createHmac, timingSafeEqual } from "node:crypto";

export function createBorzoWebhookSignature(
  rawBody: Buffer | string,
  secret: string,
): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifyBorzoWebhookSignature(input: {
  rawBody: Buffer;
  signatureHeader: string | undefined;
  secret: string;
}): boolean {
  const signature = input.signatureHeader?.trim();
  if (!signature) {
    return false;
  }

  const expected = createBorzoWebhookSignature(input.rawBody, input.secret);
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(signature, "utf8");

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}
