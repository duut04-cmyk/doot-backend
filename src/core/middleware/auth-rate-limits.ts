import type { RequestHandler } from "express";
import type { RateLimitWindow } from "./rate-limit.js";
import {
  createBodyFieldRateLimiter,
  createEmailBodyRateLimiter,
  createIpRateLimiter,
} from "./rate-limit.js";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export const AUTH_RATE_LIMIT_WINDOWS = {
  signupIp: { windowMs: FIFTEEN_MINUTES_MS, max: 10 },
  signupEmail: { windowMs: FIFTEEN_MINUTES_MS, max: 5 },
  loginIp: { windowMs: FIFTEEN_MINUTES_MS, max: 30 },
  loginEmail: { windowMs: FIFTEEN_MINUTES_MS, max: 10 },
  verifyEmailOtpIp: { windowMs: FIFTEEN_MINUTES_MS, max: 30 },
  verifyEmailOtpEmail: { windowMs: FIFTEEN_MINUTES_MS, max: 15 },
  resendEmailOtpIp: { windowMs: FIFTEEN_MINUTES_MS, max: 10 },
  resendEmailOtpEmail: { windowMs: FIFTEEN_MINUTES_MS, max: 5 },
  forgotPasswordIp: { windowMs: FIFTEEN_MINUTES_MS, max: 10 },
  forgotPasswordEmail: { windowMs: FIFTEEN_MINUTES_MS, max: 5 },
  verifyPasswordResetOtpIp: { windowMs: FIFTEEN_MINUTES_MS, max: 30 },
  verifyPasswordResetOtpEmail: { windowMs: FIFTEEN_MINUTES_MS, max: 15 },
  resendPasswordResetOtpIp: { windowMs: FIFTEEN_MINUTES_MS, max: 10 },
  resendPasswordResetOtpEmail: { windowMs: FIFTEEN_MINUTES_MS, max: 5 },
  resetPasswordIp: { windowMs: FIFTEEN_MINUTES_MS, max: 20 },
  googleLoginIp: { windowMs: FIFTEEN_MINUTES_MS, max: 30 },
  refreshIp: { windowMs: FIFTEEN_MINUTES_MS, max: 60 },
  refreshToken: { windowMs: FIFTEEN_MINUTES_MS, max: 30 },
  otpGenerateIp: { windowMs: FIFTEEN_MINUTES_MS, max: 20 },
  otpGenerateDelivery: { windowMs: FIFTEEN_MINUTES_MS, max: 10 },
  otpVerifyIp: { windowMs: FIFTEEN_MINUTES_MS, max: 30 },
  otpVerifyDelivery: { windowMs: FIFTEEN_MINUTES_MS, max: 15 },
} as const satisfies Record<string, RateLimitWindow>;

function ip(scope: keyof typeof AUTH_RATE_LIMIT_WINDOWS): RequestHandler {
  return createIpRateLimiter(scope, AUTH_RATE_LIMIT_WINDOWS[scope]);
}

function email(scope: keyof typeof AUTH_RATE_LIMIT_WINDOWS): RequestHandler {
  return createEmailBodyRateLimiter(scope, AUTH_RATE_LIMIT_WINDOWS[scope]);
}

function bodyField(
  scope: keyof typeof AUTH_RATE_LIMIT_WINDOWS,
  field: string,
): RequestHandler {
  return createBodyFieldRateLimiter(scope, field, AUTH_RATE_LIMIT_WINDOWS[scope]);
}

export const signupIpRateLimit = ip("signupIp");
export const signupEmailRateLimit = email("signupEmail");
export const loginIpRateLimit = ip("loginIp");
export const loginEmailRateLimit = email("loginEmail");
export const verifyEmailOtpIpRateLimit = ip("verifyEmailOtpIp");
export const verifyEmailOtpEmailRateLimit = email("verifyEmailOtpEmail");
export const resendEmailOtpIpRateLimit = ip("resendEmailOtpIp");
export const resendEmailOtpEmailRateLimit = email("resendEmailOtpEmail");
export const forgotPasswordIpRateLimit = ip("forgotPasswordIp");
export const forgotPasswordEmailRateLimit = email("forgotPasswordEmail");
export const verifyPasswordResetOtpIpRateLimit = ip("verifyPasswordResetOtpIp");
export const verifyPasswordResetOtpEmailRateLimit = email(
  "verifyPasswordResetOtpEmail",
);
export const resendPasswordResetOtpIpRateLimit = ip("resendPasswordResetOtpIp");
export const resendPasswordResetOtpEmailRateLimit = email(
  "resendPasswordResetOtpEmail",
);
export const resetPasswordIpRateLimit = ip("resetPasswordIp");
export const googleLoginIpRateLimit = ip("googleLoginIp");
export const refreshIpRateLimit = ip("refreshIp");
export const refreshTokenRateLimit = bodyField("refreshToken", "refreshToken");
export const otpGenerateIpRateLimit = ip("otpGenerateIp");
export const otpVerifyIpRateLimit = ip("otpVerifyIp");
