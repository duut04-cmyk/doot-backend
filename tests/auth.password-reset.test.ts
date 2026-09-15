import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import type { EmailSender } from "../src/infrastructure/email/email.service.js";
import { buildPasswordResetEmail } from "../src/infrastructure/email/templates/password-reset-email.js";
import { PASSWORD_RESET_TOKEN_EXPIRY_MINUTES } from "../src/modules/auth/auth.constants.js";
import {
  hashPasswordResetToken,
  verifyPassword,
} from "../src/modules/auth/auth.crypto.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";

describe("Auth Part 3 password reset", () => {
  let repository: InMemoryAuthRepository;
  let sentResets: Array<{ to: string; recipientName: string; resetUrl: string }>;
  let mailer: EmailSender;
  let service: AuthService;

  beforeEach(() => {
    repository = new InMemoryAuthRepository();
    sentResets = [];
    mailer = {
      sendVerificationEmail: vi.fn(async () => undefined),
      sendPasswordResetEmail: vi.fn(async (input) => {
        sentResets.push(input);
      }),
    };
    service = new AuthService(repository, mailer);
  });

  async function createVerifiedActiveUser(email = "john@example.com") {
    await service.signup({
      name: "John Doe",
      email,
      phone: "+919876543210",
      password: "StrongPassword123!",
    });
    const user = repository.users.find((item) => item.email === email)!;
    user.emailVerified = true;
    return user;
  }

  function extractToken(resetUrl: string): string {
    const url = new URL(resetUrl);
    const token = url.searchParams.get("token");
    if (!token) {
      throw new Error("Missing token in reset URL");
    }
    return token;
  }

  describe("forgotPassword", () => {
    it("creates a hashed reset token and emails a reset link for eligible users", async () => {
      await createVerifiedActiveUser();
      const result = await service.forgotPassword({
        email: "john@example.com",
      });

      expect(result).toEqual({
        success: true,
        message:
          "If an account exists for this email, a password reset link has been sent.",
      });
      expect(repository.passwordResetTokens).toHaveLength(1);
      expect(sentResets).toHaveLength(1);

      const rawToken = extractToken(sentResets[0].resetUrl);
      expect(repository.passwordResetTokens[0].tokenHash).toBe(
        hashPasswordResetToken(rawToken),
      );
      expect(JSON.stringify(repository.passwordResetTokens)).not.toContain(
        rawToken,
      );
      expect(sentResets[0].resetUrl).toContain("/reset-password?token=");

      const expectedExpiry =
        repository.passwordResetTokens[0].createdAt.getTime() +
        PASSWORD_RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000;
      expect(
        Math.abs(
          repository.passwordResetTokens[0].expiresAt.getTime() - expectedExpiry,
        ),
      ).toBeLessThan(2000);
    });

    it("returns the same generic response for unknown emails without emailing", async () => {
      const existing = await service.forgotPassword({
        email: "missing@example.com",
      });
      expect(existing.message).toContain("If an account exists");
      expect(repository.passwordResetTokens).toHaveLength(0);
      expect(sentResets).toHaveLength(0);
    });

    it("does not send reset emails for OAuth-only, suspended, or deleted users", async () => {
      await createVerifiedActiveUser("oauth@example.com");
      repository.users[0].passwordHash = null;
      await expect(
        service.forgotPassword({ email: "oauth@example.com" }),
      ).resolves.toMatchObject({ success: true });
      expect(sentResets).toHaveLength(0);

      await createVerifiedActiveUser("suspended@example.com");
      const suspended = repository.users.find(
        (u) => u.email === "suspended@example.com",
      )!;
      suspended.status = "SUSPENDED";
      await service.forgotPassword({ email: "suspended@example.com" });

      await createVerifiedActiveUser("deleted@example.com");
      const deleted = repository.users.find(
        (u) => u.email === "deleted@example.com",
      )!;
      deleted.status = "DELETED";
      await service.forgotPassword({ email: "deleted@example.com" });

      expect(sentResets).toHaveLength(0);
      expect(
        repository.passwordResetTokens.filter((t) => t.usedAt === null),
      ).toHaveLength(0);
    });

    it("invalidates previous reset tokens when a new one is requested", async () => {
      await createVerifiedActiveUser("rotate@example.com");
      await service.forgotPassword({ email: "rotate@example.com" });
      const firstToken = extractToken(sentResets[0].resetUrl);

      await service.forgotPassword({ email: "rotate@example.com" });
      const secondToken = extractToken(sentResets[1].resetUrl);

      expect(firstToken).not.toBe(secondToken);
      expect(repository.passwordResetTokens[0].usedAt).not.toBeNull();
      expect(repository.passwordResetTokens[1].usedAt).toBeNull();

      await expect(
        service.resetPassword({
          token: firstToken,
          password: "NewStrongPassword123!",
          confirmPassword: "NewStrongPassword123!",
        }),
      ).rejects.toMatchObject({
        code: ErrorCodes.INVALID_PASSWORD_RESET_TOKEN,
      });
    });

    it("keeps account enumeration responses identical", async () => {
      await createVerifiedActiveUser("exists@example.com");
      const a = await service.forgotPassword({ email: "exists@example.com" });
      const b = await service.forgotPassword({
        email: "does-not-exist@example.com",
      });
      expect(a).toEqual(b);
    });
  });

  describe("resetPassword", () => {
    async function requestReset(email = "reset@example.com") {
      await createVerifiedActiveUser(email);
      await service.forgotPassword({ email });
      return extractToken(sentResets[0].resetUrl);
    }

    it("resets the password, marks the token used, and revokes refresh sessions", async () => {
      const email = "reset-ok@example.com";
      const user = await createVerifiedActiveUser(email);
      const login = await service.login({
        email,
        password: "StrongPassword123!",
      });
      await service.login({ email, password: "StrongPassword123!" });
      expect(repository.refreshTokens.filter((t) => !t.revokedAt)).toHaveLength(
        2,
      );

      await service.forgotPassword({ email });
      const token = extractToken(sentResets[0].resetUrl);

      const result = await service.resetPassword({
        token,
        password: "NewStrongPassword123!",
        confirmPassword: "NewStrongPassword123!",
      });

      expect(result.message).toContain("Password reset successfully");
      expect(repository.passwordResetTokens[0].usedAt).not.toBeNull();
      expect(
        repository.refreshTokens.every((tokenRow) => tokenRow.revokedAt !== null),
      ).toBe(true);

      await expect(
        service.login({ email, password: "StrongPassword123!" }),
      ).rejects.toMatchObject({ code: ErrorCodes.INVALID_CREDENTIALS });

      const newLogin = await service.login({
        email,
        password: "NewStrongPassword123!",
      });
      expect(newLogin.success).toBe(true);
      expect(await verifyPassword("NewStrongPassword123!", user.passwordHash!)).toBe(
        true,
      );

      await expect(
        service.refreshSession({ refreshToken: login.data.refreshToken }),
      ).rejects.toMatchObject({ code: ErrorCodes.INVALID_REFRESH_TOKEN });

      await expect(
        service.resetPassword({
          token,
          password: "AnotherStrongPassword123!",
          confirmPassword: "AnotherStrongPassword123!",
        }),
      ).rejects.toMatchObject({
        code: ErrorCodes.INVALID_PASSWORD_RESET_TOKEN,
      });
    });

    it("rejects invalid, expired, and random tokens", async () => {
      const token = await requestReset("bad-token@example.com");

      repository.passwordResetTokens[0].expiresAt = new Date(Date.now() - 1000);
      await expect(
        service.resetPassword({
          token,
          password: "NewStrongPassword123!",
          confirmPassword: "NewStrongPassword123!",
        }),
      ).rejects.toMatchObject({
        code: ErrorCodes.INVALID_PASSWORD_RESET_TOKEN,
      });

      await expect(
        service.resetPassword({
          token: "not-a-real-token",
          password: "NewStrongPassword123!",
          confirmPassword: "NewStrongPassword123!",
        }),
      ).rejects.toMatchObject({
        code: ErrorCodes.INVALID_PASSWORD_RESET_TOKEN,
      });
    });

    it("rejects reset for deleted users after token creation", async () => {
      const email = "deleted-after@example.com";
      const token = await requestReset(email);
      repository.users.find((u) => u.email === email)!.status = "DELETED";

      await expect(
        service.resetPassword({
          token,
          password: "NewStrongPassword123!",
          confirmPassword: "NewStrongPassword123!",
        }),
      ).rejects.toMatchObject({
        code: ErrorCodes.INVALID_PASSWORD_RESET_TOKEN,
      });
    });
  });

  describe("password reset email template", () => {
    it("includes app name, reset URL, and expiry without secrets", () => {
      const content = buildPasswordResetEmail({
        appName: "Doot",
        recipientName: "John",
        resetUrl: "http://localhost:3000/reset-password?token=fake-token",
        expiryMinutes: 15,
      });

      expect(content.subject).toContain("Doot");
      expect(content.text).toContain("John");
      expect(content.text).toContain(
        "http://localhost:3000/reset-password?token=fake-token",
      );
      expect(content.text).toContain("15 minutes");
      expect(content.html).toContain("Reset Password");
      expect(content.text.toLowerCase()).not.toContain("passwordhash");
    });
  });
});
