import { afterEach, describe, expect, it, vi } from "vitest";

const KEY_A = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const KEY_B = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const PLAINTEXT_FIXTURE = "fixture-token-value-not-for-production";

async function loadCryptoModule() {
  return import("../src/modules/provider/provider.crypto.js");
}

describe("provider.crypto decrypt failures", () => {
  afterEach(() => {
    vi.resetModules();
    process.env.PROVIDER_CREDENTIALS_ENCRYPTION_KEY = KEY_A;
  });

  it("decrypt fails safely when encryption key does not match", async () => {
    process.env.PROVIDER_CREDENTIALS_ENCRYPTION_KEY = KEY_A;
    vi.resetModules();
    const { encryptCredential } = await loadCryptoModule();
    const payload = encryptCredential(PLAINTEXT_FIXTURE);

    process.env.PROVIDER_CREDENTIALS_ENCRYPTION_KEY = KEY_B;
    vi.resetModules();
    const { decryptCredential } = await loadCryptoModule();

    expect(() => decryptCredential(payload)).toThrow();
    try {
      decryptCredential(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(PLAINTEXT_FIXTURE);
    }
  });

  it("decrypt fails safely when ciphertext is corrupt", async () => {
    process.env.PROVIDER_CREDENTIALS_ENCRYPTION_KEY = KEY_A;
    vi.resetModules();
    const { encryptCredential, decryptCredential } = await loadCryptoModule();
    const payload = encryptCredential(PLAINTEXT_FIXTURE);
    const corrupt = {
      ...payload,
      ciphertext: Buffer.from(payload.ciphertext, "base64")
        .reverse()
        .toString("base64"),
    };

    expect(() => decryptCredential(corrupt)).toThrow();
    try {
      decryptCredential(corrupt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(PLAINTEXT_FIXTURE);
    }
  });

  it("decrypt fails safely when authentication tag is invalid", async () => {
    process.env.PROVIDER_CREDENTIALS_ENCRYPTION_KEY = KEY_A;
    vi.resetModules();
    const { encryptCredential, decryptCredential } = await loadCryptoModule();
    const payload = encryptCredential(PLAINTEXT_FIXTURE);
    const tagBytes = Buffer.from(payload.authTag, "base64");
    tagBytes[0] ^= 0xff;
    const invalidTag = {
      ...payload,
      authTag: tagBytes.toString("base64"),
    };

    expect(() => decryptCredential(invalidTag)).toThrow();
    try {
      decryptCredential(invalidTag);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(PLAINTEXT_FIXTURE);
    }
  });

  it("decrypt fails safely when IV is invalid length", async () => {
    process.env.PROVIDER_CREDENTIALS_ENCRYPTION_KEY = KEY_A;
    vi.resetModules();
    const { encryptCredential, decryptCredential } = await loadCryptoModule();
    const payload = encryptCredential(PLAINTEXT_FIXTURE);
    const invalidIv = {
      ...payload,
      iv: Buffer.from("short").toString("base64"),
    };

    expect(() => decryptCredential(invalidIv)).toThrow();
    try {
      decryptCredential(invalidIv);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(PLAINTEXT_FIXTURE);
    }
  });
});
