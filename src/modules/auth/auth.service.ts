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
  EMAIL_VERIFICATION_OTP_EXPIRY_MINUTES,
  MAX_OTP_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
} from "./auth.constants.js";
import {
  buildPasswordResetTokenExpiry,
  buildPasswordResetUrl,
  buildRefreshTokenExpiry,
  emailDomain,
  generateAccessToken,
  generateEmailVerificationOtp,
  generatePasswordResetToken,
  generateRefreshToken,
  getAccessTokenExpiresInSeconds,
  hashOtp,
  hashPassword,
  hashPasswordResetToken,
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
import type {
  AuthMessageResult,
  ForgotPasswordInput,
  GoogleLoginInput,
  LoginInput,
  LoginResult,
  LogoutInput,
  MeResult,
  RefreshResult,
  RefreshSessionInput,
  ResendOtpInput,
  ResetPasswordInput,
  SignupInput,
  VerifyOtpInput,
} from "./auth.types.js";
import { toAuthenticatedUser, toPublicUserProfile } from "./auth.types.js";

const GENERIC_OTP_ERROR = "Invalid or expired verification code";
const GENERIC_CREDENTIALS_ERROR = "Invalid email or password.";
const GENERIC_REFRESH_ERROR = "Invalid or expired refresh token.";
const GENERIC_RESET_TOKEN_ERROR = "Invalid or expired password reset token.";
const GENERIC_FORGOT_PASSWORD_MESSAGE =
  "If an account exists for this email, a password reset link has been sent.";

export class AuthService {
  constructor(
    private readonly repository: IAuthRepository = authRepository,
    private readonly mailer: EmailSender = emailService,
    private readonly googleVerifier: GoogleCredentialVerifier = googleIdTokenVerifier,
  ) {}

  async signup(input: SignupInput): Promise<AuthMessageResult> {
    const email = normalizeEmail(input.email);
    const name = input.name.trim();
    const phone = input.phone?.trim() || null;

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
            phone,
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
            phone,
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

    logger.info(
      { userId, emailDomain: emailDomain(email) },
      "verification email sent",
    );

    return {
      success: true,
      message:
        "Account created. Please check your email for the verification code.",
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
      const updated = await this.repository.incrementVerificationOtpAttempts(
        record.id,
      );
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
        throw new AppError(
          "Please wait before requesting another verification code",
          {
            statusCode: 429,
            code: ErrorCodes.OTP_RESEND_COOLDOWN,
          },
        );
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

    const passwordMatches = await verifyPassword(
      input.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      logger.info(
        { userId: user.id, emailDomain: emailDomain(email) },
        "login_failed",
      );
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
    const identity = await this.googleVerifier.verifyIdToken(
      input.credential.trim(),
    );
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

      try {
        await this.repository.createOAuthAccount({
          userId: existingUser.id,
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

      return this.issueSession(existingUser, "Login successful.");
    }

    const displayName =
      identity.name?.trim() || email.split("@")[0] || "Dutt User";

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

    if (
      !existing ||
      existing.revokedAt ||
      existing.expiresAt.getTime() <= Date.now()
    ) {
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
    logger.info(
      { emailDomain: emailDomain(email) },
      "password_reset_requested",
    );

    const genericSuccess: AuthMessageResult = {
      success: true,
      message: GENERIC_FORGOT_PASSWORD_MESSAGE,
    };

    const user = await this.repository.findUserByEmail(email);
    if (!user || !user.passwordHash || user.status !== "ACTIVE") {
      return genericSuccess;
    }

    const rawToken = generatePasswordResetToken();
    const tokenHash = hashPasswordResetToken(rawToken);
    const expiresAt = buildPasswordResetTokenExpiry();

    let resetUrl: string;
    try {
      resetUrl = buildPasswordResetUrl(rawToken);
    } catch {
      logger.error(
        { userId: user.id, emailDomain: emailDomain(email) },
        "password_reset_failed",
      );
      throw new AppError("Unable to send password reset email at this time", {
        statusCode: 503,
        code: ErrorCodes.EMAIL_DELIVERY_FAILED,
      });
    }

    await this.repository.withTransaction(async (tx) => {
      await this.repository.invalidatePasswordResetTokens(user.id, tx);
      await this.repository.createPasswordResetToken(
        {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
        tx,
      );
    });

    await this.mailer.sendPasswordResetEmail({
      to: email,
      recipientName: user.name,
      resetUrl,
    });

    logger.info({ userId: user.id }, "password_reset_email_sent");
    return genericSuccess;
  }

  async resetPassword(input: ResetPasswordInput): Promise<AuthMessageResult> {
    const rawToken = input.token.trim();
    const tokenHash = hashPasswordResetToken(rawToken);
    const record = await this.repository.findPasswordResetTokenByHash(tokenHash);

    if (
      !record ||
      record.usedAt ||
      record.expiresAt.getTime() <= Date.now()
    ) {
      logger.info("password_reset_failed");
      throw new AppError(GENERIC_RESET_TOKEN_ERROR, {
        statusCode: 400,
        code: ErrorCodes.INVALID_PASSWORD_RESET_TOKEN,
      });
    }

    const user = await this.repository.findUserById(record.userId);
    if (!user || user.status === "DELETED") {
      logger.info({ userId: record.userId }, "password_reset_failed");
      throw new AppError(GENERIC_RESET_TOKEN_ERROR, {
        statusCode: 400,
        code: ErrorCodes.INVALID_PASSWORD_RESET_TOKEN,
      });
    }

    if (user.status === "SUSPENDED") {
      logger.info({ userId: user.id }, "password_reset_failed");
      throw new AppError(GENERIC_RESET_TOKEN_ERROR, {
        statusCode: 400,
        code: ErrorCodes.INVALID_PASSWORD_RESET_TOKEN,
      });
    }

    const passwordHash = await hashPassword(input.password);

    await this.repository.withTransaction(async (tx) => {
      await this.repository.updateUserPassword(user.id, passwordHash, tx);
      await this.repository.markPasswordResetTokenUsed(record.id, tx);
      await this.repository.revokeAllRefreshTokens(user.id, tx);
    });

    logger.info({ userId: user.id }, "password_reset_completed");

    return {
      success: true,
      message: "Password reset successfully. Please log in again.",
    };
  }

  private async issueSession(
    user: User,
    message: string,
  ): Promise<LoginResult> {
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
    return new Date(
      from.getTime() + EMAIL_VERIFICATION_OTP_EXPIRY_MINUTES * 60 * 1000,
    );
  }
}

export const authService = new AuthService();
