import { describe, expect, it } from "vitest";
import {
  generateEmailVerificationOtp,
  hashPassword,
  verifyOtpHash,
  verifyPassword,
  hashOtp,
} from "../src/modules/auth/auth.crypto.js";
import { EMAIL_VERIFICATION_OTP_EXPIRY_MINUTES } from "../src/modules/auth/auth.constants.js";

describe("auth.crypto", () => {
  it("generates a 6-digit cryptographically secure OTP", () => {
    const otp = generateEmailVerificationOtp();
    expect(otp).toMatch(/^\d{6}$/);
    expect(Number(otp)).toBeGreaterThanOrEqual(100000);
    expect(Number(otp)).toBeLessThanOrEqual(999999);
  });

  it("hashes passwords with bcrypt and never equals plaintext", async () => {
    const password = "StrongPassword123!";
    const hash = await hashPassword(password);
    expect(hash).not.toBe(password);
    expect(hash.startsWith("$2")).toBe(true);
    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("hashes OTPs with bcrypt", async () => {
    const otp = "123456";
    const hash = await hashOtp(otp);
    expect(hash).not.toBe(otp);
    expect(await verifyOtpHash(otp, hash)).toBe(true);
    expect(await verifyOtpHash("000000", hash)).toBe(false);
  });

  it("uses a 15-minute OTP expiry constant", () => {
    expect(EMAIL_VERIFICATION_OTP_EXPIRY_MINUTES).toBe(15);
  });
});
