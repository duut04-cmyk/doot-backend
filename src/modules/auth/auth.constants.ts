export const AUTH_MODULE_NAME = "auth" as const;

/** Email verification OTP validity window. */
export const EMAIL_VERIFICATION_OTP_EXPIRY_MINUTES = 15;

/** Maximum failed OTP verification attempts per code. */
export const MAX_OTP_ATTEMPTS = 5;

/** Minimum seconds between OTP resend emails for the same user. */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

/** bcrypt cost factor fallback when env is unavailable in isolated tests. */
export const DEFAULT_BCRYPT_ROUNDS = 12;

/** Default access-token lifetime when env is unset. */
export const DEFAULT_JWT_ACCESS_EXPIRES_IN = "15m";

/** Default refresh-token lifetime in days when env is unset. */
export const DEFAULT_REFRESH_TOKEN_EXPIRES_IN_DAYS = 30;

/** Default post-OTP password-reset verification token lifetime in seconds. */
export const DEFAULT_PASSWORD_RESET_VERIFICATION_TOKEN_EXPIRY_SECONDS = 600;

export const ACCESS_TOKEN_TYPE = "access" as const;
