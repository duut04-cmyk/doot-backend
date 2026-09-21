import { logger } from "../../config/logger.js";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import {
  googleIdTokenVerifier,
  type GoogleCredentialVerifier,
} from "../../infrastructure/auth/google-verifier.js";
import {
  emailService,
  type EmailSender,
} from "../../infrastructure/email/email.service.js";
import type { User } from "@prisma/client";
import {
  OTP_EXPIRY_SECONDS,
  OTP_GENERATION_COOLDOWN_SECONDS,
  OTP_MAX_ATTEMPTS,
} from "../../config/env.js";
import {
  EMAIL_VERIFICATION_OTP_EXPIRY_MINUTES,
  MAX_OTP_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
} from "./auth.constants.js";
import {
  buildPasswordResetVerificationTokenExpiry,
  buildRefreshTokenExpiry,
  emailDomain,
  generateAccessToken,
  generateEmailVerificationOtp,
  generatePasswordResetVerificationToken,
  generateRefreshToken,
  getAccessTokenExpiresInSeconds,
  hashOpaqueToken,
  hashOtp,
  hashPassword,
  hashRefreshToken,
  normalizeEmail,
  verifyOtpHash,
  verifyPassword,
} from "./auth.crypto.js";
import {
  authRepository,
  isUniqueConstraintError,
  type IAuthRepository,
} from "./auth.repository.js";
import { passwordSchema } from "./auth.schema.js";
import type {
  AuthMessageResult,
  ForgotPasswordInput,
  GoogleLoginInput,
  LoginInput,
  LoginResult,
  LogoutInput,
  MeResult,
  PasswordResetVerifyResult,
  RefreshResult,
  RefreshSessionInput,
  ResendOtpInput,
  ResendPasswordResetOtpInput,
  ResetPasswordInput,
  SignupInput,
  VerifyOtpInput,
  VerifyPasswordResetOtpInput,
} from "./auth.types.js";
import { toAuthenticatedUser, toPublicUserProfile } from "./auth.types.js";

const GENERIC_OTP_ERROR = "Invalid or expired verification code";
const GENERIC_CREDENTIALS_ERROR = "Invalid email or password.";
const GENERIC_REFRESH_ERROR = "Invalid or expired refresh token.";
const GENERIC_PASSWORD_RESET_OTP_ERROR = "Invalid or expired verification code";
const GENERIC_RESET_TOKEN_ERROR = "Invalid or expired password reset token.";
const GENERIC_FORGOT_PASSWORD_MESSAGE =
  "If an account exists for this email, a verification code has been sent.";

export class AuthService {
  constructor(
    private readonly repository: IAuthRepository = authRepository,
    private readonly mailer: EmailSender = emailService,
    private readonly googleVerifier: GoogleCredentialVerifier = googleIdTokenVerifier,
  ) {}

  async signup(input: SignupInput): Promise<AuthMessageResult> {
    const email = normalizeEmail(input.email);
    const name = input.name.trim();
    const phoneCountryCode = input.phoneCountryCode?.trim() || null;
    const phoneNumber = input.phoneNumber?.trim() || null;

    logger.info({ emailDomain: emailDomain(email) }, "signup requested");

    const existing = await this.repository.findUserByEmail(email);

    if (existing?.emailVerified) {
      throw new AppError("An account with this email already exists", {
        statusCode: 409,
        code: ErrorCodes.EMAIL_ALREADY_REGISTERED,
      });
    }

    const passwordHash = await hashPassword(input.password);
    const otp = generateEmailVerificationOtp();
    const otpHash = await hashOtp(otp);
    const expiresAt = this.buildOtpExpiry();

    let userId: string;
    let recipientName: string;

    if (existing) {
      const updated = await this.repository.withTransaction(async (tx) => {
        const user = await this.repository.updateUser(
          existing.id,
          {
            name,
            phoneCountryCode,
            phoneNumber,
            passwordHash,
          },
          tx,
        );
        await this.repository.invalidateVerificationOtps(user.id, tx);
        await this.repository.createVerificationOtp(
          { userId: user.id, otpHash, expiresAt },
          tx,
        );
        return user;
      });
      userId = updated.id;
      recipientName = updated.name;
    } else {
      const created = await this.repository.withTransaction(async (tx) => {
        const user = await this.repository.createUser(
          {
            name,
            email,
            phoneCountryCode,
            phoneNumber,
            passwordHash,
          },
          tx,
        );
        await this.repository.createVerificationOtp(
          { userId: user.id, otpHash, expiresAt },
          tx,
        );
        return user;
      });
      userId = created.id;
      recipientName = created.name;
    }

    await this.mailer.sendVerificationEmail({
      to: email,
      recipientName,
      otp,
    });

    logger.info({ userId, emailDomain: emailDomain(email) }, "verification email sent");

    return {
      success: true,
      message: "Account created. Please check your email for the verification code.",
    };
  }

  async verifyOtp(input: VerifyOtpInput): Promise<AuthMessageResult> {
    const email = normalizeEmail(input.email);
    const otp = input.otp.trim();

    const user = await this.repository.findUserByEmail(email);
    if (!user || user.emailVerified) {
      throw new AppError(GENERIC_OTP_ERROR, {
        statusCode: 400,
        code: ErrorCodes.INVALID_VERIFICATION_CODE,
      });
    }

    const record = await this.repository.findLatestVerificationOtp(user.id);
    if (!record || record.usedAt) {
      throw new AppError(GENERIC_OTP_ERROR, {
        statusCode: 400,
        code: ErrorCodes.INVALID_VERIFICATION_CODE,
      });
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      logger.info(
        { userId: user.id, emailDomain: emailDomain(email) },
        "verification failed",
      );
      throw new AppError(GENERIC_OTP_ERROR, {
        statusCode: 400,
        code: ErrorCodes.VERIFICATION_CODE_EXPIRED,
      });
    }

    if (record.attempts >= MAX_OTP_ATTEMPTS) {
      await this.repository.markVerificationOtpUsed(record.id);
      logger.info(
        { userId: user.id, emailDomain: emailDomain(email) },
        "verification failed",
      );
      throw new AppError(GENERIC_OTP_ERROR, {
        statusCode: 400,
        code: ErrorCodes.VERIFICATION_CODE_MAX_ATTEMPTS,
      });
    }

    const matches = await verifyOtpHash(otp, record.otpHash);
    if (!matches) {
      const updated = await this.repository.incrementVerificationOtpAttempts(record.id);
      if (updated.attempts >= MAX_OTP_ATTEMPTS) {
        await this.repository.markVerificationOtpUsed(record.id);
        logger.info(
          { userId: user.id, emailDomain: emailDomain(email) },
          "verification failed",
        );
        throw new AppError(GENERIC_OTP_ERROR, {
          statusCode: 400,
          code: ErrorCodes.VERIFICATION_CODE_MAX_ATTEMPTS,
        });
      }

      logger.info(
        { userId: user.id, emailDomain: emailDomain(email) },
        "verification failed",
      );
      throw new AppError(GENERIC_OTP_ERROR, {
        statusCode: 400,
        code: ErrorCodes.INVALID_VERIFICATION_CODE,
      });
    }

    await this.repository.withTransaction(async (tx) => {
      await this.repository.markVerificationOtpUsed(record.id, tx);
      await this.repository.updateUser(user.id, { emailVerified: true }, tx);
    });

    logger.info(
      { userId: user.id, emailDomain: emailDomain(email) },
      "verification succeeded",
    );

    return {
      success: true,
      message: "Email verified successfully.",
    };
  }

  async resendOtp(input: ResendOtpInput): Promise<AuthMessageResult> {
    const email = normalizeEmail(input.email);
    logger.info({ emailDomain: emailDomain(email) }, "OTP resend requested");

    const genericSuccess: AuthMessageResult = {
      success: true,
      message:
        "If an account exists for this email, a verification code has been sent.",
    };

    const user = await this.repository.findUserByEmail(email);
    if (!user) {
      return genericSuccess;
    }

    if (user.emailVerified) {
      return {
        success: true,
        message: "Email is already verified.",
      };
    }

    const latest = await this.repository.findLatestVerificationOtp(user.id);
    if (latest) {
      const elapsedMs = Date.now() - latest.createdAt.getTime();
      if (elapsedMs < OTP_RESEND_COOLDOWN_SECONDS * 1000) {
        throw new AppError("Please wait before requesting another verification code", {
          statusCode: 429,
          code: ErrorCodes.OTP_RESEND_COOLDOWN,
        });
      }
    }

    const otp = generateEmailVerificationOtp();
    const otpHash = await hashOtp(otp);
    const expiresAt = this.buildOtpExpiry();

    await this.repository.withTransaction(async (tx) => {
      await this.repository.invalidateVerificationOtps(user.id, tx);
      await this.repository.createVerificationOtp(
        { userId: user.id, otpHash, expiresAt },
        tx,
      );
    });

    await this.mailer.sendVerificationEmail({
      to: email,
      recipientName: user.name,
      otp,
    });

    logger.info(
      { userId: user.id, emailDomain: emailDomain(email) },
      "verification email sent",
    );

    return genericSuccess;
  }

  async login(input: LoginInput): Promise<LoginResult> {
    const email = normalizeEmail(input.email);

    const user = await this.repository.findUserByEmail(email);
    if (!user || !user.passwordHash) {
      logger.info({ emailDomain: emailDomain(email) }, "login_failed");
      throw new AppError(GENERIC_CREDENTIALS_ERROR, {
        statusCode: 401,
        code: ErrorCodes.INVALID_CREDENTIALS,
      });
    }

    const passwordMatches = await verifyPassword(input.password, user.passwordHash);
    if (!passwordMatches) {
      logger.info({ userId: user.id, emailDomain: emailDomain(email) }, "login_failed");
      throw new AppError(GENERIC_CREDENTIALS_ERROR, {
        statusCode: 401,
        code: ErrorCodes.INVALID_CREDENTIALS,
      });
    }

    if (!user.emailVerified) {
      throw new AppError("Please verify your email before logging in.", {
        statusCode: 403,
        code: ErrorCodes.EMAIL_NOT_VERIFIED,
      });
    }

    this.assertLoginAccountStatus(user.status);

    return this.issueSession(user, "Login successful.");
  }

  async googleLogin(input: GoogleLoginInput): Promise<LoginResult> {
    const identity = await this.googleVerifier.verifyIdToken(input.credential.trim());
    const email = normalizeEmail(identity.email);
    const providerAccountId = identity.sub;

    logger.info(
      { emailDomain: emailDomain(email), provider: "google" },
      "google_login_requested",
    );

    const existingOAuth = await this.repository.findOAuthAccount(
      "GOOGLE",
      providerAccountId,
    );

    if (existingOAuth) {
      this.assertLoginAccountStatus(existingOAuth.user.status);
      return this.issueSession(existingOAuth.user, "Login successful.");
    }

    const existingUser = await this.repository.findUserByEmail(email);
    if (existingUser) {
      this.assertLoginAccountStatus(existingUser.status);

      let linkedUser = existingUser;
      if (!existingUser.emailVerified) {
        linkedUser = await this.repository.updateUser(existingUser.id, {
          emailVerified: true,
        });
      }

      try {
        await this.repository.createOAuthAccount({
          userId: linkedUser.id,
          provider: "GOOGLE",
          providerAccountId,
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error;
        }

        const raced = await this.repository.findOAuthAccount(
          "GOOGLE",
          providerAccountId,
        );
        if (!raced) {
          throw new AppError("Google authentication failed.", {
            statusCode: 401,
            code: ErrorCodes.GOOGLE_AUTHENTICATION_FAILED,
            cause: error,
          });
        }
        this.assertLoginAccountStatus(raced.user.status);
        return this.issueSession(raced.user, "Login successful.");
      }

      return this.issueSession(linkedUser, "Login successful.");
    }

    const displayName = identity.name?.trim() || email.split("@")[0] || "Dutt User";

    let createdUser: User;
    try {
      const created = await this.repository.createUserWithOAuthAccount({
        user: {
          name: displayName,
          email,
          passwordHash: null,
          emailVerified: true,
        },
        oauth: {
          provider: "GOOGLE",
          providerAccountId,
        },
      });
      createdUser = created.user;
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      const racedOAuth = await this.repository.findOAuthAccount(
        "GOOGLE",
        providerAccountId,
      );
      if (racedOAuth) {
        this.assertLoginAccountStatus(racedOAuth.user.status);
        return this.issueSession(racedOAuth.user, "Login successful.");
      }

      const racedUser = await this.repository.findUserByEmail(email);
      if (racedUser) {
        this.assertLoginAccountStatus(racedUser.status);
        await this.repository.createOAuthAccount({
          userId: racedUser.id,
          provider: "GOOGLE",
          providerAccountId,
        });
        return this.issueSession(racedUser, "Login successful.");
      }

      throw new AppError("Google authentication failed.", {
        statusCode: 401,
        code: ErrorCodes.GOOGLE_AUTHENTICATION_FAILED,
        cause: error,
      });
    }

    return this.issueSession(createdUser, "Login successful.");
  }

  async refreshSession(input: RefreshSessionInput): Promise<RefreshResult> {
    const rawToken = input.refreshToken.trim();
    const tokenHash = hashRefreshToken(rawToken);
    const existing = await this.repository.findRefreshTokenByHash(tokenHash);

    if (!existing || existing.revokedAt || existing.expiresAt.getTime() <= Date.now()) {
      logger.info("refresh_failed");
      throw new AppError(GENERIC_REFRESH_ERROR, {
        statusCode: 401,
        code: ErrorCodes.INVALID_REFRESH_TOKEN,
      });
    }

    const user = await this.repository.findUserById(existing.userId);
    if (!user || !user.emailVerified || user.status !== "ACTIVE") {
      logger.info({ userId: existing.userId }, "refresh_failed");
      throw new AppError(GENERIC_REFRESH_ERROR, {
        statusCode: 401,
        code: ErrorCodes.INVALID_REFRESH_TOKEN,
      });
    }

    const accessToken = generateAccessToken(user.id);
    const nextRefreshToken = generateRefreshToken();
    const nextHash = hashRefreshToken(nextRefreshToken);
    const expiresAt = buildRefreshTokenExpiry();

    await this.repository.withTransaction(async (tx) => {
      await this.repository.revokeRefreshToken(existing.id, tx);
      await this.repository.createRefreshToken(
        {
          userId: user.id,
          tokenHash: nextHash,
          expiresAt,
        },
        tx,
      );
    });

    logger.info({ userId: user.id }, "refresh_success");

    return {
      success: true,
      message: "Token refreshed.",
      data: {
        accessToken,
        refreshToken: nextRefreshToken,
        tokenType: "Bearer",
        expiresIn: getAccessTokenExpiresInSeconds(),
      },
    };
  }

  async logout(input: LogoutInput): Promise<AuthMessageResult> {
    const rawToken = input.refreshToken.trim();
    const tokenHash = hashRefreshToken(rawToken);
    const existing = await this.repository.findRefreshTokenByHash(tokenHash);

    if (existing && !existing.revokedAt) {
      await this.repository.revokeRefreshToken(existing.id);
      logger.info({ userId: existing.userId }, "logout");
    } else {
      logger.info("logout");
    }

    return {
      success: true,
      message: "Logged out successfully.",
    };
  }

  async getCurrentUser(userId: string): Promise<MeResult> {
    const user = await this.repository.findAuthenticatedUserById(userId);
    if (!user || user.status !== "ACTIVE") {
      throw new AppError("Authentication required.", {
        statusCode: 401,
        code: ErrorCodes.UNAUTHORIZED,
      });
    }

    return {
      success: true,
      data: {
        user: toAuthenticatedUser(user),
      },
    };
  }

  async forgotPassword(input: ForgotPasswordInput): Promise<AuthMessageResult> {
    const email = normalizeEmail(input.email);
    logger.info({ emailDomain: emailDomain(email) }, "password_reset_requested");

    const genericSuccess: AuthMessageResult = {
      success: true,
      message: GENERIC_FORGOT_PASSWORD_MESSAGE,
    };

    const user = await this.repository.findUserByEmail(email);
    if (!this.isPasswordResetEligible(user)) {
      return genericSuccess;
    }

    await this.issuePasswordResetOtp(user, email);
    return genericSuccess;
  }

  async verifyPasswordResetOtp(
    input: VerifyPasswordResetOtpInput,
  ): Promise<PasswordResetVerifyResult> {
    const email = normalizeEmail(input.email);
    const otp = input.otp.trim();

    const user = await this.repository.findUserByEmail(email);
    if (!this.isPasswordResetEligible(user)) {
      logger.info({ emailDomain: emailDomain(email) }, "password_reset_otp_failed");
      throw new AppError(GENERIC_PASSWORD_RESET_OTP_ERROR, {
        statusCode: 400,
        code: ErrorCodes.PASSWORD_RESET_OTP_INVALID,
      });
    }

    const record = await this.repository.findLatestPasswordResetOtp(user.id);
    if (!record || record.consumedAt) {
      logger.info({ userId: user.id }, "password_reset_otp_failed");
      throw new AppError(GENERIC_PASSWORD_RESET_OTP_ERROR, {
        statusCode: 400,
        code: ErrorCodes.PASSWORD_RESET_OTP_INVALID,
      });
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      logger.info({ userId: user.id }, "password_reset_otp_failed");
      throw new AppError(GENERIC_PASSWORD_RESET_OTP_ERROR, {
        statusCode: 400,
        code: ErrorCodes.PASSWORD_RESET_OTP_EXPIRED,
      });
    }

    if (record.attempts >= record.maxAttempts) {
      logger.info({ userId: user.id }, "password_reset_otp_failed");
      throw new AppError(GENERIC_PASSWORD_RESET_OTP_ERROR, {
        statusCode: 400,
        code: ErrorCodes.PASSWORD_RESET_OTP_MAX_ATTEMPTS,
      });
    }

    const matches = await verifyOtpHash(otp, record.codeHash);
    if (!matches) {
      const updated = await this.repository.incrementPasswordResetOtpAttempts(
        record.id,
        record.maxAttempts,
      );
      logger.info({ userId: user.id }, "password_reset_otp_failed");
      if (!updated || updated.attempts >= updated.maxAttempts) {
        throw new AppError(GENERIC_PASSWORD_RESET_OTP_ERROR, {
          statusCode: 400,
          code: ErrorCodes.PASSWORD_RESET_OTP_MAX_ATTEMPTS,
        });
      }
      throw new AppError(GENERIC_PASSWORD_RESET_OTP_ERROR, {
        statusCode: 400,
        code: ErrorCodes.PASSWORD_RESET_OTP_INVALID,
      });
    }

    const rawResetToken = generatePasswordResetVerificationToken();
    const tokenHash = hashOpaqueToken(rawResetToken);
    const expiresAt = buildPasswordResetVerificationTokenExpiry();

    const consumed = await this.repository.withTransaction(async (tx) => {
      const claimed = await this.repository.consumePasswordResetOtp(record.id, tx);
      if (!claimed) {
        return null;
      }
      await this.repository.invalidatePasswordResetVerificationTokens(user.id, tx);
      await this.repository.createPasswordResetVerificationToken(
        {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
        tx,
      );
      return claimed;
    });

    if (!consumed) {
      logger.info({ userId: user.id }, "password_reset_otp_failed");
      throw new AppError(GENERIC_PASSWORD_RESET_OTP_ERROR, {
        statusCode: 400,
        code: ErrorCodes.PASSWORD_RESET_OTP_INVALID,
      });
    }

    logger.info({ userId: user.id }, "password_reset_otp_verified");

    return {
      success: true,
      data: {
        resetToken: rawResetToken,
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  async resendPasswordResetOtp(
    input: ResendPasswordResetOtpInput,
  ): Promise<AuthMessageResult> {
    const email = normalizeEmail(input.email);
    logger.info(
      { emailDomain: emailDomain(email) },
      "password_reset_otp_resend_requested",
    );

    const genericSuccess: AuthMessageResult = {
      success: true,
      message: GENERIC_FORGOT_PASSWORD_MESSAGE,
    };

    const user = await this.repository.findUserByEmail(email);
    if (!this.isPasswordResetEligible(user)) {
      return genericSuccess;
    }

    const latest = await this.repository.findLatestPasswordResetOtp(user.id);
    if (latest) {
      const elapsedMs = Date.now() - latest.createdAt.getTime();
      if (elapsedMs < OTP_GENERATION_COOLDOWN_SECONDS * 1000) {
        throw new AppError("Please wait before requesting another verification code", {
          statusCode: 429,
          code: ErrorCodes.PASSWORD_RESET_OTP_COOLDOWN,
        });
      }
    }

    await this.issuePasswordResetOtp(user, email);
    return genericSuccess;
  }

  async resetPassword(input: ResetPasswordInput): Promise<AuthMessageResult> {
    const passwordResult = passwordSchema.safeParse(input.newPassword);
    if (!passwordResult.success) {
      throw new AppError(
        passwordResult.error.issues[0]?.message ?? "Invalid password",
        {
          statusCode: 400,
          code: ErrorCodes.VALIDATION_ERROR,
        },
      );
    }

    const rawToken = input.resetToken.trim();
    const tokenHash = hashOpaqueToken(rawToken);
    const record =
      await this.repository.findPasswordResetVerificationTokenByHash(tokenHash);

    if (!record) {
      logger.info("password_reset_failed");
      throw new AppError(GENERIC_RESET_TOKEN_ERROR, {
        statusCode: 400,
        code: ErrorCodes.PASSWORD_RESET_TOKEN_INVALID,
      });
    }

    if (record.usedAt) {
      logger.info({ userId: record.userId }, "password_reset_failed");
      throw new AppError(GENERIC_RESET_TOKEN_ERROR, {
        statusCode: 400,
        code: ErrorCodes.PASSWORD_RESET_TOKEN_USED,
      });
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      logger.info({ userId: record.userId }, "password_reset_failed");
      throw new AppError(GENERIC_RESET_TOKEN_ERROR, {
        statusCode: 400,
        code: ErrorCodes.PASSWORD_RESET_TOKEN_EXPIRED,
      });
    }

    const user = await this.repository.findUserById(record.userId);
    if (!user || user.status === "DELETED" || user.status === "SUSPENDED") {
      logger.info({ userId: record.userId }, "password_reset_failed");
      throw new AppError(GENERIC_RESET_TOKEN_ERROR, {
        statusCode: 400,
        code: ErrorCodes.PASSWORD_RESET_TOKEN_INVALID,
      });
    }

    if (user.passwordHash) {
      const sameAsCurrent = await verifyPassword(input.newPassword, user.passwordHash);
      if (sameAsCurrent) {
        throw new AppError(
          "New password must be different from your current password.",
          {
            statusCode: 400,
            code: ErrorCodes.PASSWORD_SAME_AS_CURRENT,
          },
        );
      }
    }

    const passwordHash = await hashPassword(input.newPassword);

    const marked = await this.repository.withTransaction(async (tx) => {
      const current = await this.repository.findPasswordResetVerificationTokenByHash(
        tokenHash,
        tx,
      );
      if (!current || current.usedAt || current.expiresAt.getTime() <= Date.now()) {
        return null;
      }

      await this.repository.updateUserPassword(user.id, passwordHash, tx);
      const used = await this.repository.markPasswordResetVerificationTokenUsed(
        current.id,
        tx,
      );
      if (!used) {
        return null;
      }
      await this.repository.revokeAllRefreshTokens(user.id, tx);
      return used;
    });

    if (!marked) {
      logger.info({ userId: record.userId }, "password_reset_failed");
      throw new AppError(GENERIC_RESET_TOKEN_ERROR, {
        statusCode: 400,
        code: ErrorCodes.PASSWORD_RESET_TOKEN_USED,
      });
    }

    logger.info({ userId: user.id }, "password_reset_completed");

    return {
      success: true,
      message: "Password reset successfully. Please log in again.",
    };
  }

  private async issueSession(user: User, message: string): Promise<LoginResult> {
    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken();
    const tokenHash = hashRefreshToken(refreshToken);
    const expiresAt = buildRefreshTokenExpiry();

    await this.repository.createRefreshToken({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    logger.info({ userId: user.id }, "login_success");

    return {
      success: true,
      message,
      data: {
        accessToken,
        refreshToken,
        tokenType: "Bearer",
        expiresIn: getAccessTokenExpiresInSeconds(),
        user: toPublicUserProfile(user),
      },
    };
  }

  private assertLoginAccountStatus(status: string): void {
    if (status === "SUSPENDED") {
      throw new AppError("Account is suspended.", {
        statusCode: 403,
        code: ErrorCodes.ACCOUNT_SUSPENDED,
      });
    }

    if (status === "DELETED") {
      throw new AppError("Account is unavailable.", {
        statusCode: 403,
        code: ErrorCodes.ACCOUNT_DELETED,
      });
    }

    if (status !== "ACTIVE") {
      throw new AppError(GENERIC_CREDENTIALS_ERROR, {
        statusCode: 401,
        code: ErrorCodes.INVALID_CREDENTIALS,
      });
    }
  }

  private buildOtpExpiry(from: Date = new Date()): Date {
    return new Date(from.getTime() + EMAIL_VERIFICATION_OTP_EXPIRY_MINUTES * 60 * 1000);
  }

  private buildPasswordResetOtpExpiry(from: Date = new Date()): Date {
    return new Date(from.getTime() + OTP_EXPIRY_SECONDS * 1000);
  }

  private isPasswordResetEligible(
    user: User | null,
  ): user is User & { passwordHash: string } {
    return !!(user && user.passwordHash && user.status === "ACTIVE");
  }

  private async issuePasswordResetOtp(user: User, email: string): Promise<void> {
    const otp = generateEmailVerificationOtp();
    const codeHash = await hashOtp(otp);
    const expiresAt = this.buildPasswordResetOtpExpiry();

    await this.repository.withTransaction(async (tx) => {
      await this.repository.invalidatePasswordResetOtps(user.id, tx);
      await this.repository.createPasswordResetOtp(
        {
          userId: user.id,
          codeHash,
          expiresAt,
          maxAttempts: OTP_MAX_ATTEMPTS,
        },
        tx,
      );
    });

    await this.mailer.sendPasswordResetOtpEmail({
      to: email,
      recipientName: user.name,
      otp,
    });

    logger.info({ userId: user.id }, "password_reset_otp_email_sent");
  }
}

export const authService = new AuthService();
