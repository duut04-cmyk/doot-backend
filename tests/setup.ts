process.env.NODE_ENV = "test";
process.env.PORT = "5000";
process.env.APP_NAME = "Doot";
process.env.BCRYPT_ROUNDS = "10";
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ||
  "test-only-jwt-access-secret-min-32-chars!!";
process.env.JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || "15m";
process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS =
  process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS || "30";
process.env.PASSWORD_RESET_TOKEN_EXPIRES_MINUTES =
  process.env.PASSWORD_RESET_TOKEN_EXPIRES_MINUTES || "15";
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
process.env.PROVIDER_CREDENTIALS_ENCRYPTION_KEY =
  process.env.PROVIDER_CREDENTIALS_ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.BORZO_CALLBACK_SECRET =
  process.env.BORZO_CALLBACK_SECRET ||
  "test-borzo-callback-secret-min-16-chars";
