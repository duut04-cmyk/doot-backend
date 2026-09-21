import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { env, requireJwtAccessSecret } from "../../config/env.js";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import {
  ACCESS_TOKEN_TYPE,
  DEFAULT_BCRYPT_ROUNDS,
  DEFAULT_JWT_ACCESS_EXPIRES_IN,
  DEFAULT_PASSWORD_RESET_VERIFICATION_TOKEN_EXPIRY_SECONDS,
  DEFAULT_REFRESH_TOKEN_EXPIRES_IN_DAYS,
} from "./auth.constants.js";
import type { AccessTokenPayload } from "./auth.types.js";

function bcryptRounds(): number {
  return env.BCRYPT_ROUNDS ?? DEFAULT_BCRYPT_ROUNDS;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1) : "unknown";
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, bcryptRounds());
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

/** Cryptographically secure 6-digit OTP (100000–999999). */
export function generateEmailVerificationOtp(): string {
  return String(randomInt(100_000, 1_000_000));
}

export async function hashOtp(otp: string): Promise<string> {
  return bcrypt.hash(otp, bcryptRounds());
}

export async function verifyOtpHash(
  otp: string,
  otpHash: string,
): Promise<boolean> {
  return bcrypt.compare(otp, otpHash);
}

export function getAccessTokenExpiresIn(): string {
  return env.JWT_ACCESS_EXPIRES_IN ?? DEFAULT_JWT_ACCESS_EXPIRES_IN;
}

export function getRefreshTokenExpiresInDays(): number {
  return (
    env.REFRESH_TOKEN_EXPIRES_IN_DAYS ?? DEFAULT_REFRESH_TOKEN_EXPIRES_IN_DAYS
  );
}

/** Convert values like `15m`, `1h`, `7d`, or bare seconds into seconds. */
export function durationToSeconds(value: string): number {
  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  const match = /^(\d+)([smhd])$/i.exec(value.trim());
  if (!match) {
    throw new Error(`Unsupported duration format: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case "s":
      return amount;
    case "m":
      return amount * 60;
    case "h":
      return amount * 60 * 60;
    case "d":
      return amount * 60 * 60 * 24;
    default:
      throw new Error(`Unsupported duration unit: ${unit}`);
  }
}

export function getAccessTokenExpiresInSeconds(): number {
  return durationToSeconds(getAccessTokenExpiresIn());
}

export function generateAccessToken(userId: string): string {
  const payload: AccessTokenPayload = {
    sub: userId,
    type: ACCESS_TOKEN_TYPE,
  };

  return jwt.sign(payload, requireJwtAccessSecret(), {
    expiresIn: getAccessTokenExpiresInSeconds(),
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, requireJwtAccessSecret());
    if (!decoded || typeof decoded !== "object") {
      throw new AppError("Invalid or expired access token.", {
        statusCode: 401,
        code: ErrorCodes.INVALID_ACCESS_TOKEN,
      });
    }

    const sub = "sub" in decoded ? decoded.sub : undefined;
    const type = "type" in decoded ? decoded.type : undefined;

    if (typeof sub !== "string" || sub.length === 0) {
      throw new AppError("Invalid or expired access token.", {
        statusCode: 401,
        code: ErrorCodes.INVALID_ACCESS_TOKEN,
      });
    }

    if (type !== ACCESS_TOKEN_TYPE) {
      throw new AppError("Invalid or expired access token.", {
        statusCode: 401,
        code: ErrorCodes.INVALID_ACCESS_TOKEN,
      });
    }

    return { sub, type: ACCESS_TOKEN_TYPE };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError("Invalid or expired access token.", {
        statusCode: 401,
        code: ErrorCodes.TOKEN_EXPIRED,
      });
    }

    throw new AppError("Invalid or expired access token.", {
      statusCode: 401,
      code: ErrorCodes.INVALID_ACCESS_TOKEN,
      cause: error,
    });
  }
}

/** Cryptographically secure opaque refresh token (base64url). */
export function generateRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

/** Deterministic SHA-256 hash for direct refresh-token lookup. */
export function hashRefreshToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function verifyRefreshToken(
  rawToken: string,
  tokenHash: string,
): boolean {
  const computed = Buffer.from(hashRefreshToken(rawToken), "utf8");
  const stored = Buffer.from(tokenHash, "utf8");
  if (computed.length !== stored.length) {
    return false;
  }
  return timingSafeEqual(computed, stored);
}

export function buildRefreshTokenExpiry(from: Date = new Date()): Date {
  return new Date(
    from.getTime() + getRefreshTokenExpiresInDays() * 24 * 60 * 60 * 1000,
  );
}

/** Cryptographically secure opaque password-reset verification token (32+ bytes). */
export function generatePasswordResetVerificationToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Deterministic SHA-256 hash for opaque token lookup (refresh / reset verification). */
export function hashOpaqueToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/** @deprecated Use hashOpaqueToken */
export function hashPasswordResetToken(rawToken: string): string {
  return hashOpaqueToken(rawToken);
}

export function getPasswordResetVerificationTokenExpirySeconds(): number {
  return (
    env.PASSWORD_RESET_VERIFICATION_TOKEN_EXPIRY_SECONDS ??
    DEFAULT_PASSWORD_RESET_VERIFICATION_TOKEN_EXPIRY_SECONDS
  );
}

export function buildPasswordResetVerificationTokenExpiry(
  from: Date = new Date(),
): Date {
  return new Date(
    from.getTime() +
      getPasswordResetVerificationTokenExpirySeconds() * 1000,
  );
}
