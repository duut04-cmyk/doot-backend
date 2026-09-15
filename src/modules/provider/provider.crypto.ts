import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env, requireProviderCredentialsEncryptionKey } from "../../config/env.js";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

export type EncryptedCredential = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

export function encryptCredential(plaintext: string): EncryptedCredential {
  const key = requireProviderCredentialsEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

/** Internal use only — never expose via HTTP responses. */
export function decryptCredential(payload: EncryptedCredential): string {
  if (env.NODE_ENV === "test" && !env.PROVIDER_CREDENTIALS_ENCRYPTION_KEY) {
    throw new AppError("Credential decryption is not configured.", {
      statusCode: 503,
      code: ErrorCodes.PROVIDER_CREDENTIALS_NOT_CONFIGURED,
    });
  }

  const key = requireProviderCredentialsEncryptionKey();
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(payload.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
