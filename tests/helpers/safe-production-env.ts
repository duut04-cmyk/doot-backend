/** Minimal production-safe env inputs for envSchema regression tests (no secrets). */
export const baseSafeProductionEnv = {
  NODE_ENV: "production",
  JWT_ACCESS_SECRET: "x".repeat(32),
  PAYMENT_GATEWAY: "cashfree",
  CASHFREE_ENABLED: "true",
  CASHFREE_CLIENT_ID: "cf-client-id",
  CASHFREE_CLIENT_SECRET: "cf-client-secret",
  CASHFREE_ENVIRONMENT: "sandbox",
  SMS_PROVIDER: "twilio",
  TWILIO_ACCOUNT_SID: "ACtest123456789",
  TWILIO_AUTH_TOKEN: "twilio-auth-token",
  TWILIO_FROM_NUMBER: "+15550001111",
} as const;
