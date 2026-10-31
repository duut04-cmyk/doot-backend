process.env.NODE_ENV = "test";

// Unit tests use in-memory repos; do not hit .env DATABASE_URL unless TEST_DATABASE_URL is set.
if (!process.env.TEST_DATABASE_URL?.trim()) {
  process.env.DATABASE_URL = "";
  process.env.DIRECT_URL = "";
}
process.env.MSG91_ENABLED = "false";
process.env.SMS_PROVIDER = "mock";
// Prevent local .env trial override from affecting unit tests
process.env.SMS_OTP_RECIPIENT_OVERRIDE = "";
process.env.PORT = "5000";
process.env.APP_NAME = "Doot";
process.env.BCRYPT_ROUNDS = "10";
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || "test-only-jwt-access-secret-min-32-chars!!";
process.env.JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || "15m";
process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS =
  process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS || "30";
process.env.PASSWORD_RESET_VERIFICATION_TOKEN_EXPIRY_SECONDS =
  process.env.PASSWORD_RESET_VERIFICATION_TOKEN_EXPIRY_SECONDS || "600";
process.env.OTP_EXPIRY_SECONDS = process.env.OTP_EXPIRY_SECONDS || "900";
process.env.OTP_MAX_ATTEMPTS = process.env.OTP_MAX_ATTEMPTS || "5";
process.env.OTP_GENERATION_COOLDOWN_SECONDS =
  process.env.OTP_GENERATION_COOLDOWN_SECONDS || "60";
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
process.env.PROVIDER_CREDENTIALS_ENCRYPTION_KEY =
  process.env.PROVIDER_CREDENTIALS_ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
