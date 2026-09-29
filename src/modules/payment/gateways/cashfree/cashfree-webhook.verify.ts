import { createHmac, timingSafeEqual } from "node:crypto";

export function computeCashfreeWebhookSignature(input: {
  timestamp: string;
  rawBody: string;
  secretKey: string;
}): string {
  const signatureString = `${input.timestamp}${input.rawBody}`;
  return createHmac("sha256", input.secretKey).update(signatureString).digest("base64");
}

export function verifyCashfreeWebhookSignature(input: {
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: string;
  secretKey: string;
}): boolean {
  if (!input.timestamp || !input.signature) {
    return false;
  }
  const expected = computeCashfreeWebhookSignature({
    timestamp: input.timestamp,
    rawBody: input.rawBody,
    secretKey: input.secretKey,
  });
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(input.signature);
  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, actualBuf);
}
