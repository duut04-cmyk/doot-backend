import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/core/errors/app-error.js";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import type { EmailSender } from "../src/infrastructure/email/email.service.js";
import {
  EMAIL_VERIFICATION_OTP_EXPIRY_MINUTES,
  MAX_OTP_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
} from "../src/modules/auth/auth.constants.js";
import { verifyOtpHash, verifyPassword } from "../src/modules/auth/auth.crypto.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";

describe("AuthService", () => {
  let repository: InMemoryAuthRepository;
  let sentEmails: Array<{ to: string; recipientName: string; otp: string }>;
  let mailer: EmailSender;
  let service: AuthService;

  beforeEach(() => {
    repository = new InMemoryAuthRepository();
    sentEmails = [];
    mailer = {
      sendVerificationEmail: vi.fn(async (input) => {
        sentEmails.push(input);
      }),
      sendPasswordResetOtpEmail: vi.fn(async () => undefined),
      sendPickupOtpEmail: vi.fn(async () => undefined),
      sendDeliveryOtpEmail: vi.fn(async () => undefined),
    };
    service = new AuthService(repository, mailer);
  });

  describe("signup", () => {
    it("creates a user, stores bcrypt password hash, hashes OTP, and emails OTP", async () => {
      const result = await service.signup({
        name: "John Doe",
        email: "John@Example.com",
        phoneCountryCode: "+91",
        phoneNumber: "9876543210",
        password: "StrongPassword123!",
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("verification code");

      const user = repository.users[0];
      expect(user.email).toBe("john@example.com");
      expect(user.passwordHash).toBeTruthy();
      expect(user.passwordHash).not.toBe("StrongPassword123!");
      expect(await verifyPassword("StrongPassword123!", user.passwordHash!)).toBe(
        true,
      );
      expect(user.emailVerified).toBe(false);

      const otp = repository.otps[0];
      expect(otp.otpHash).toBeTruthy();
      expect(JSON.stringify(repository.otps)).not.toContain(sentEmails[0].otp);
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0].otp).toMatch(/^\d{6}$/);
      expect(await verifyOtpHash(sentEmails[0].otp, otp.otpHash)).toBe(true);

      const expectedExpiry =
        otp.createdAt.getTime() +
        EMAIL_VERIFICATION_OTP_EXPIRY_MINUTES * 60 * 1000;
      expect(Math.abs(otp.expiresAt.getTime() - expectedExpiry)).toBeLessThan(
        2000,
      );
    });

    it("rejects a verified duplicate email", async () => {
      await service.signup({
        name: "John Doe",
        email: "john@example.com",
        password: "StrongPassword123!",
      });
      repository.users[0].emailVerified = true;

      await expect(
        service.signup({
          name: "John Doe",
          email: "john@example.com",
          password: "StrongPassword123!",
        }),
      ).rejects.toMatchObject({
        code: ErrorCodes.EMAIL_ALREADY_REGISTERED,
        statusCode: 409,
      });
    });

    it("refreshes OTP for an existing unverified user without duplicating the account", async () => {
      await service.signup({
        name: "John Doe",
        email: "john@example.com",
        password: "StrongPassword123!",
      });
      const firstOtp = sentEmails[0].otp;

      await service.signup({
        name: "Jonathan Doe",
        email: "john@example.com",
        password: "AnotherStrong123!",
      });

      expect(repository.users).toHaveLength(1);
      expect(repository.users[0].name).toBe("Jonathan Doe");
      expect(repository.otps.filter((otp) => otp.usedAt === null)).toHaveLength(
        1,
      );
      expect(sentEmails).toHaveLength(2);
      expect(sentEmails[1].otp).not.toBe(firstOtp);
      expect(await verifyOtpHash(firstOtp, repository.otps[0].otpHash)).toBe(
        true,
      );
      expect(repository.otps[0].usedAt).not.toBeNull();
    });

    it("surfaces email delivery failures without returning the OTP", async () => {
      mailer.sendVerificationEmail = vi.fn(async () => {
        throw new AppError("Unable to send verification email at this time", {
          statusCode: 503,
          code: ErrorCodes.EMAIL_DELIVERY_FAILED,
        });
      });
      service = new AuthService(repository, mailer);

      await expect(
        service.signup({
          name: "John Doe",
          email: "john@example.com",
          password: "StrongPassword123!",
        }),
      ).rejects.toMatchObject({
        code: ErrorCodes.EMAIL_DELIVERY_FAILED,
      });

      expect(repository.users).toHaveLength(1);
      expect(repository.otps).toHaveLength(1);
    });
  });

  describe("verifyOtp", () => {
    async function signupAndCaptureOtp() {
      await service.signup({
        name: "John Doe",
        email: "john@example.com",
        password: "StrongPassword123!",
      });
      return sentEmails[0].otp;
    }

    it("verifies a valid OTP and marks it used", async () => {
      const otp = await signupAndCaptureOtp();
      const result = await service.verifyOtp({
        email: "john@example.com",
        otp,
      });

      expect(result).toEqual({
        success: true,
        message: "Email verified successfully.",
      });
      expect(repository.users[0].emailVerified).toBe(true);
      expect(repository.otps[0].usedAt).not.toBeNull();

      await expect(
        service.verifyOtp({ email: "john@example.com", otp }),
      ).rejects.toMatchObject({
        code: ErrorCodes.INVALID_VERIFICATION_CODE,
      });
    });

    it("rejects an invalid OTP and increments attempts", async () => {
      await signupAndCaptureOtp();
      await expect(
        service.verifyOtp({ email: "john@example.com", otp: "000000" }),
      ).rejects.toMatchObject({
        code: ErrorCodes.INVALID_VERIFICATION_CODE,
      });
      expect(repository.otps[0].attempts).toBe(1);
    });

    it("rejects an expired OTP", async () => {
      const otp = await signupAndCaptureOtp();
      repository.otps[0].expiresAt = new Date(Date.now() - 1000);

      await expect(
        service.verifyOtp({ email: "john@example.com", otp }),
      ).rejects.toMatchObject({
        code: ErrorCodes.VERIFICATION_CODE_EXPIRED,
      });
    });

    it("locks out after maximum attempts", async () => {
      await signupAndCaptureOtp();

      for (let i = 0; i < MAX_OTP_ATTEMPTS; i += 1) {
        await expect(
          service.verifyOtp({ email: "john@example.com", otp: "000000" }),
        ).rejects.toBeInstanceOf(AppError);
      }

      expect(repository.otps[0].attempts).toBe(MAX_OTP_ATTEMPTS);
      expect(repository.otps[0].usedAt).not.toBeNull();
    });
  });

  describe("resendOtp", () => {
    it("resends a new OTP and invalidates the previous one", async () => {
      await service.signup({
        name: "John Doe",
        email: "john@example.com",
        password: "StrongPassword123!",
      });
      const firstOtp = sentEmails[0].otp;
      repository.otps[0].createdAt = new Date(
        Date.now() - (OTP_RESEND_COOLDOWN_SECONDS + 1) * 1000,
      );

      const result = await service.resendOtp({ email: "john@example.com" });
      expect(result.success).toBe(true);
      expect(sentEmails).toHaveLength(2);
      expect(sentEmails[1].otp).not.toBe(firstOtp);
      expect(repository.otps[0].usedAt).not.toBeNull();
      expect(repository.otps[1].usedAt).toBeNull();
    });

    it("enforces resend cooldown", async () => {
      await service.signup({
        name: "John Doe",
        email: "john@example.com",
        password: "StrongPassword123!",
      });

      await expect(
        service.resendOtp({ email: "john@example.com" }),
      ).rejects.toMatchObject({
        code: ErrorCodes.OTP_RESEND_COOLDOWN,
        statusCode: 429,
      });
    });

    it("does not reveal whether an unknown email exists", async () => {
      const result = await service.resendOtp({
        email: "missing@example.com",
      });
      expect(result.success).toBe(true);
      expect(sentEmails).toHaveLength(0);
    });

    it("does not send another OTP when already verified", async () => {
      await service.signup({
        name: "John Doe",
        email: "john@example.com",
        password: "StrongPassword123!",
      });
      repository.users[0].emailVerified = true;
      sentEmails.length = 0;

      const result = await service.resendOtp({ email: "john@example.com" });
      expect(result.message).toContain("already verified");
      expect(sentEmails).toHaveLength(0);
    });
  });
});
