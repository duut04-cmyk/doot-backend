import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OTP_EXPIRY_SECONDS,
  OTP_GENERATION_COOLDOWN_SECONDS,
  OTP_MAX_ATTEMPTS,
} from "../src/config/env.js";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import type { EmailSender } from "../src/infrastructure/email/email.service.js";
import { buildPasswordResetOtpEmail } from "../src/infrastructure/email/templates/password-reset-otp-email.js";
import {
  hashOpaqueToken,
  verifyOtpHash,
  verifyPassword,
} from "../src/modules/auth/auth.crypto.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";

describe("Auth password reset OTP flow", () => {
  let repository: InMemoryAuthRepository;
  let sentOtps: Array<{ to: string; recipientName: string; otp: string }>;
  let mailer: EmailSender;
  let service: AuthService;

  beforeEach(() => {
    repository = new InMemoryAuthRepository();
    sentOtps = [];
    mailer = {
      sendVerificationEmail: vi.fn(async () => undefined),
      sendPickupOtpEmail: vi.fn(async () => undefined),
      sendDeliveryOtpEmail: vi.fn(async () => undefined),
      sendPasswordResetOtpEmail: vi.fn(async (input) => {
        sentOtps.push(input);
      }),
    };
    service = new AuthService(repository, mailer);
  });

  async function createVerifiedActiveUser(email = "john@example.com") {
    await service.signup({
      name: "John Doe",
      email,
      phoneCountryCode: "+91",
      phoneNumber: "9876543210",
      password: "StrongPassword123!",
    });
    const user = repository.users.find((item) => item.email === email)!;
    user.emailVerified = true;
    return user;
  }

  async function requestReset(email = "john@example.com") {
    await createVerifiedActiveUser(email);
    await service.forgotPassword({ email });
    return sentOtps[0].otp;
  }

  async function verifyOtpAndGetResetToken(
    email: string,
    otp: string,
  ): Promise<string> {
    const result = await service.verifyPasswordResetOtp({ email, otp });
    return result.data.resetToken;
  }

  describe("forgotPassword", () => {
    it("creates a hashed OTP and emails it for eligible users", async () => {
      await createVerifiedActiveUser();
      const result = await service.forgotPassword({ email: "john@example.com" });

      expect(result.message).toContain("verification code has been sent");
      expect(repository.passwordResetOtps).toHaveLength(1);
      expect(sentOtps).toHaveLength(1);
      expect(sentOtps[0].otp).toMatch(/^\d{6}$/);
      expect(
        await verifyOtpHash(
          sentOtps[0].otp,
          repository.passwordResetOtps[0].codeHash,
        ),
      ).toBe(true);
      expect(JSON.stringify(repository.passwordResetOtps)).not.toContain(
        sentOtps[0].otp,
      );

      const expectedExpiry =
        repository.passwordResetOtps[0].createdAt.getTime() +
        OTP_EXPIRY_SECONDS * 1000;
      expect(
        Math.abs(
          repository.passwordResetOtps[0].expiresAt.getTime() - expectedExpiry,
        ),
      ).toBeLessThan(2000);
    });

    it("returns the same generic response for unknown emails without emailing", async () => {
      const result = await service.forgotPassword({
        email: "missing@example.com",
      });
      expect(result.message).toContain("If an account exists");
      expect(repository.passwordResetOtps).toHaveLength(0);
      expect(sentOtps).toHaveLength(0);
    });

    it("does not send OTP for OAuth-only, suspended, or deleted users", async () => {
      await createVerifiedActiveUser("oauth@example.com");
      repository.users.find((u) => u.email === "oauth@example.com")!.passwordHash =
        null;
      await service.forgotPassword({ email: "oauth@example.com" });

      await createVerifiedActiveUser("suspended@example.com");
      repository.users.find((u) => u.email === "suspended@example.com")!.status =
        "SUSPENDED";
      await service.forgotPassword({ email: "suspended@example.com" });

      await createVerifiedActiveUser("deleted@example.com");
      repository.users.find((u) => u.email === "deleted@example.com")!.status =
        "DELETED";
      await service.forgotPassword({ email: "deleted@example.com" });

      expect(sentOtps).toHaveLength(0);
      expect(
        repository.passwordResetOtps.filter((otp) => otp.consumedAt === null),
      ).toHaveLength(0);
    });

    it("keeps account enumeration responses identical", async () => {
      await createVerifiedActiveUser("exists@example.com");
      const existing = await service.forgotPassword({
        email: "exists@example.com",
      });
      const missing = await service.forgotPassword({
        email: "does-not-exist@example.com",
      });
      expect(existing).toEqual(missing);
    });
  });

  describe("verifyPasswordResetOtp", () => {
    it("returns an opaque reset token stored hashed", async () => {
      const email = "verify@example.com";
      const otp = await requestReset(email);
      const result = await service.verifyPasswordResetOtp({ email, otp });

      expect(result.success).toBe(true);
      expect(result.data.resetToken.length).toBeGreaterThan(20);
      expect(repository.passwordResetVerificationTokens).toHaveLength(1);
      expect(repository.passwordResetVerificationTokens[0].tokenHash).toBe(
        hashOpaqueToken(result.data.resetToken),
      );
      expect(JSON.stringify(repository.passwordResetVerificationTokens)).not.toContain(
        result.data.resetToken,
      );
      expect(repository.passwordResetOtps[0].consumedAt).not.toBeNull();
    });

    it("rejects invalid, expired, and replayed OTPs", async () => {
      const email = "invalid@example.com";
      const otp = await requestReset(email);

      await expect(
        service.verifyPasswordResetOtp({ email, otp: "000000" }),
      ).rejects.toMatchObject({
        code: ErrorCodes.PASSWORD_RESET_OTP_INVALID,
      });

      repository.passwordResetOtps[0].expiresAt = new Date(Date.now() - 1000);
      await expect(
        service.verifyPasswordResetOtp({ email, otp }),
      ).rejects.toMatchObject({
        code: ErrorCodes.PASSWORD_RESET_OTP_EXPIRED,
      });

      repository.passwordResetOtps[0].expiresAt = new Date(
        Date.now() + OTP_EXPIRY_SECONDS * 1000,
      );
      await service.verifyPasswordResetOtp({ email, otp });
      await expect(
        service.verifyPasswordResetOtp({ email, otp }),
      ).rejects.toMatchObject({
        code: ErrorCodes.PASSWORD_RESET_OTP_INVALID,
      });
    });

    it("enforces max attempts", async () => {
      const email = "attempts@example.com";
      await requestReset(email);

      for (let i = 0; i < OTP_MAX_ATTEMPTS - 1; i += 1) {
        await expect(
          service.verifyPasswordResetOtp({ email, otp: "000000" }),
        ).rejects.toMatchObject({
          code: ErrorCodes.PASSWORD_RESET_OTP_INVALID,
        });
      }

      await expect(
        service.verifyPasswordResetOtp({ email, otp: "000000" }),
      ).rejects.toMatchObject({
        code: ErrorCodes.PASSWORD_RESET_OTP_MAX_ATTEMPTS,
      });
    });

    it("allows only one concurrent successful OTP verification", async () => {
      const email = "race@example.com";
      const otp = await requestReset(email);

      const results = await Promise.allSettled([
        service.verifyPasswordResetOtp({ email, otp }),
        service.verifyPasswordResetOtp({ email, otp }),
      ]);

      const fulfilled = results.filter((item) => item.status === "fulfilled");
      const rejected = results.filter((item) => item.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(repository.passwordResetVerificationTokens).toHaveLength(1);
    });
  });

  describe("resendPasswordResetOtp", () => {
    it("creates a new OTP and invalidates the previous one", async () => {
      const email = "resend@example.com";
      const firstOtp = await requestReset(email);
      const firstRecordId = repository.passwordResetOtps[0].id;

      repository.passwordResetOtps[0].createdAt = new Date(
        Date.now() - (OTP_GENERATION_COOLDOWN_SECONDS + 1) * 1000,
      );

      await service.resendPasswordResetOtp({ email });
      expect(sentOtps).toHaveLength(2);
      expect(sentOtps[1].otp).not.toBe(firstOtp);
      expect(repository.passwordResetOtps[0].consumedAt).not.toBeNull();
      expect(repository.passwordResetOtps[1].consumedAt).toBeNull();

      await expect(
        service.verifyPasswordResetOtp({ email, otp: firstOtp }),
      ).rejects.toMatchObject({
        code: ErrorCodes.PASSWORD_RESET_OTP_INVALID,
      });

      const resetToken = await verifyOtpAndGetResetToken(
        email,
        sentOtps[1].otp,
      );
      expect(resetToken.length).toBeGreaterThan(10);
      expect(firstRecordId).not.toBe(repository.passwordResetOtps[1].id);
    });

    it("enforces resend cooldown", async () => {
      const email = "cooldown@example.com";
      await requestReset(email);

      await expect(
        service.resendPasswordResetOtp({ email }),
      ).rejects.toMatchObject({
        code: ErrorCodes.PASSWORD_RESET_OTP_COOLDOWN,
      });
    });

    it("remains enumeration-safe", async () => {
      await createVerifiedActiveUser("exists-resend@example.com");
      const existing = await service.resendPasswordResetOtp({
        email: "exists-resend@example.com",
      });
      const missing = await service.resendPasswordResetOtp({
        email: "missing-resend@example.com",
      });
      expect(existing).toEqual(missing);
    });
  });

  describe("resetPassword", () => {
    it("changes password, revokes refresh sessions, and rejects token replay", async () => {
      const email = "reset-ok@example.com";
      const user = await createVerifiedActiveUser(email);
      const emailVerifiedBefore = user.emailVerified;
      const login = await service.login({
        email,
        password: "StrongPassword123!",
      });
      await service.login({ email, password: "StrongPassword123!" });
      expect(repository.refreshTokens.filter((t) => !t.revokedAt)).toHaveLength(
        2,
      );

      await service.forgotPassword({ email });
      const otp = sentOtps[0].otp;
      const resetToken = await verifyOtpAndGetResetToken(email, otp);

      const result = await service.resetPassword({
        resetToken,
        newPassword: "NewStrongPassword123!",
      });

      expect(result.message).toContain("Password reset successfully");
      expect(repository.passwordResetVerificationTokens[0].usedAt).not.toBeNull();
      expect(
        repository.refreshTokens.every((tokenRow) => tokenRow.revokedAt !== null),
      ).toBe(true);
      expect(user.emailVerified).toBe(emailVerifiedBefore);

      await expect(
        service.login({ email, password: "StrongPassword123!" }),
      ).rejects.toMatchObject({ code: ErrorCodes.INVALID_CREDENTIALS });

      const newLogin = await service.login({
        email,
        password: "NewStrongPassword123!",
      });
      expect(newLogin.success).toBe(true);
      expect(newLogin.data.accessToken).toBeTruthy();
      expect(newLogin.data.refreshToken).toBeTruthy();
      expect(await verifyPassword("NewStrongPassword123!", user.passwordHash!)).toBe(
        true,
      );

      await expect(
        service.refreshSession({ refreshToken: login.data.refreshToken }),
      ).rejects.toMatchObject({ code: ErrorCodes.INVALID_REFRESH_TOKEN });

      await expect(
        service.resetPassword({
          resetToken,
          newPassword: "AnotherStrongPassword123!",
        }),
      ).rejects.toMatchObject({
        code: ErrorCodes.PASSWORD_RESET_TOKEN_USED,
      });
    });

    it("rejects invalid, expired, and malformed reset tokens", async () => {
      const email = "bad-token@example.com";
      const otp = await requestReset(email);
      const resetToken = await verifyOtpAndGetResetToken(email, otp);

      repository.passwordResetVerificationTokens[0].expiresAt = new Date(
        Date.now() - 1000,
      );
      await expect(
        service.resetPassword({
          resetToken,
          newPassword: "NewStrongPassword123!",
        }),
      ).rejects.toMatchObject({
        code: ErrorCodes.PASSWORD_RESET_TOKEN_EXPIRED,
      });

      await expect(
        service.resetPassword({
          resetToken: "not-a-real-token",
          newPassword: "NewStrongPassword123!",
        }),
      ).rejects.toMatchObject({
        code: ErrorCodes.PASSWORD_RESET_TOKEN_INVALID,
      });
    });

    it("rejects a new password that matches the current password", async () => {
      const email = "same-password@example.com";
      const currentPassword = "StrongPassword123!";
      const otp = await requestReset(email);
      const resetToken = await verifyOtpAndGetResetToken(email, otp);

      await expect(
        service.resetPassword({
          resetToken,
          newPassword: currentPassword,
        }),
      ).rejects.toMatchObject({
        code: ErrorCodes.PASSWORD_SAME_AS_CURRENT,
      });

      expect(repository.passwordResetVerificationTokens[0].usedAt).toBeNull();
    });

    it("does not consume token when password validation fails upstream", async () => {
      const email = "policy@example.com";
      const otp = await requestReset(email);
      const resetToken = await verifyOtpAndGetResetToken(email, otp);

      await expect(
        service.resetPassword({
          resetToken,
          newPassword: "short",
        }),
      ).rejects.toMatchObject({
        code: ErrorCodes.VALIDATION_ERROR,
      });

      expect(repository.passwordResetVerificationTokens[0].usedAt).toBeNull();
    });

    it("rejects reset for deleted users after token creation", async () => {
      const email = "deleted-after@example.com";
      const otp = await requestReset(email);
      const resetToken = await verifyOtpAndGetResetToken(email, otp);
      repository.users.find((u) => u.email === email)!.status = "DELETED";

      await expect(
        service.resetPassword({
          resetToken,
          newPassword: "NewStrongPassword123!",
        }),
      ).rejects.toMatchObject({
        code: ErrorCodes.PASSWORD_RESET_TOKEN_INVALID,
      });
    });
  });

  describe("password reset OTP email template", () => {
    it("includes app name, OTP, and expiry without secrets", () => {
      const content = buildPasswordResetOtpEmail({
        appName: "Doot",
        recipientName: "John",
        otp: "123456",
        expiryMinutes: 15,
      });

      expect(content.subject).toContain("Doot");
      expect(content.text).toContain("John");
      expect(content.text).toContain("123456");
      expect(content.text).toContain("15 minutes");
      expect(content.html).toContain("123456");
      expect(content.text.toLowerCase()).not.toContain("passwordhash");
      expect(content.text.toLowerCase()).not.toContain("refreshtoken");
    });
  });
});
