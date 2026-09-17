import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

/**
 * Central environment configuration.
 *
 * Never log secrets or connection strings.
 */
const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(5000),
    APP_NAME: z.preprocess(
      emptyToUndefined,
      z.string().min(1).default("Doot"),
    ),

    DATABASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    DIRECT_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),

    JWT_ACCESS_SECRET: z.preprocess(
      emptyToUndefined,
      z.string().min(32).optional(),
    ),
    JWT_ACCESS_EXPIRES_IN: z.preprocess(
      emptyToUndefined,
      z.string().min(1).default("15m"),
    ),
    // Reserved for future JWT refresh strategy; Part 2 uses opaque refresh tokens.
    JWT_REFRESH_SECRET: z.preprocess(
      emptyToUndefined,
      z.string().min(1).optional(),
    ),
    REFRESH_TOKEN_EXPIRES_IN_DAYS: z.coerce
      .number()
      .int()
      .positive()
      .default(30),
    PASSWORD_RESET_VERIFICATION_TOKEN_EXPIRY_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(600),

    RESEND_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    RESEND_FROM_EMAIL: z.preprocess(
      emptyToUndefined,
      z.string().email().optional(),
    ),
    EMAIL_FROM: z.preprocess(emptyToUndefined, z.string().email().optional()),

    BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

    GOOGLE_CLIENT_ID: z.preprocess(
      emptyToUndefined,
      z.string().min(1).optional(),
    ),
    GOOGLE_CLIENT_SECRET: z.preprocess(
      emptyToUndefined,
      z.string().min(1).optional(),
    ),

    FRONTEND_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    ADMIN_FRONTEND_URL: z.preprocess(
      emptyToUndefined,
      z.string().url().optional(),
    ),

    // Optional bootstrap admin credentials for prisma seed only.
    ADMIN_EMAIL: z.preprocess(emptyToUndefined, z.string().email().optional()),
    ADMIN_PASSWORD: z.preprocess(
      emptyToUndefined,
      z.string().min(8).max(128).optional(),
    ),

    // AES-256-GCM key for provider credentials (32 bytes as base64 or 64-char hex).
    PROVIDER_CREDENTIALS_ENCRYPTION_KEY: z.preprocess(
      emptyToUndefined,
      z.string().min(32).optional(),
    ),

    // Registers MockProviderAdapter at startup (test env always enables this).
    ENABLE_MOCK_PROVIDER_ADAPTER: z
      .preprocess((value) => value === "true" || value === true, z.boolean())
      .optional()
      .default(false),

    BORZO_SANDBOX_SMOKE_TEST: z
      .preprocess((value) => value === "true" || value === true, z.boolean())
      .optional()
      .default(false),

    BORZO_E2E_ENABLED: z
      .preprocess((value) => value === "true" || value === true, z.boolean())
      .optional()
      .default(false),

    BORZO_WEBHOOKS_ENABLED: z
      .preprocess((value) => value === "true" || value === true, z.boolean())
      .optional()
      .default(false),

    BORZO_CALLBACK_SECRET: z.preprocess(
      emptyToUndefined,
      z.string().min(16).optional(),
    ),

    BOOKING_QUOTE_MAX_AGE_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(300),

    BOOKING_PRICE_TOLERANCE_PERCENT: z.coerce
      .number()
      .min(0)
      .max(100)
      .default(0),

    OTP_EXPIRY_SECONDS: z.coerce.number().int().positive().default(600),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    OTP_GENERATION_COOLDOWN_SECONDS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(60),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV !== "test" && !data.JWT_ACCESS_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["JWT_ACCESS_SECRET"],
        message:
          "JWT_ACCESS_SECRET is required outside the test environment (min 32 characters)",
      });
    }

    if (
      data.NODE_ENV !== "test" &&
      data.BORZO_WEBHOOKS_ENABLED &&
      !data.BORZO_CALLBACK_SECRET
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["BORZO_CALLBACK_SECRET"],
        message:
          "BORZO_CALLBACK_SECRET is required when BORZO_WEBHOOKS_ENABLED is true",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return parsed.data;
}

export const env = loadEnv();

/** Verified Resend sender address. */
export function getEmailFromAddress(): string | undefined {
  return env.EMAIL_FROM ?? env.RESEND_FROM_EMAIL;
}

export function requireJwtAccessSecret(): string {
  if (!env.JWT_ACCESS_SECRET) {
    throw new Error("JWT_ACCESS_SECRET is not configured");
  }
  return env.JWT_ACCESS_SECRET;
}

export function requireGoogleClientId(): string {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new Error("GOOGLE_CLIENT_ID is not configured");
  }
  return env.GOOGLE_CLIENT_ID;
}

function decodeEncryptionKey(raw: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32) {
    return decoded;
  }
  if (raw.length >= 32) {
    return Buffer.from(raw.slice(0, 32), "utf8");
  }
  throw new Error("PROVIDER_CREDENTIALS_ENCRYPTION_KEY must decode to 32 bytes");
}

export function requireProviderCredentialsEncryptionKey(): Buffer {
  const raw = env.PROVIDER_CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("PROVIDER_CREDENTIALS_ENCRYPTION_KEY is not configured");
  }
  return decodeEncryptionKey(raw);
}

export function requireBorzoCallbackSecret(): string {
  const secret = env.BORZO_CALLBACK_SECRET;
  if (!secret) {
    throw new Error("BORZO_CALLBACK_SECRET is not configured");
  }
  return secret;
}

export const DEFAULT_BOOKING_QUOTE_MAX_AGE_SECONDS =
  env.BOOKING_QUOTE_MAX_AGE_SECONDS;

export const DEFAULT_BOOKING_PRICE_TOLERANCE_PERCENT =
  env.BOOKING_PRICE_TOLERANCE_PERCENT;

export const OTP_EXPIRY_SECONDS = env.OTP_EXPIRY_SECONDS;
export const OTP_MAX_ATTEMPTS = env.OTP_MAX_ATTEMPTS;
export const OTP_GENERATION_COOLDOWN_SECONDS =
  env.OTP_GENERATION_COOLDOWN_SECONDS;

export const PASSWORD_RESET_VERIFICATION_TOKEN_EXPIRY_SECONDS =
  env.PASSWORD_RESET_VERIFICATION_TOKEN_EXPIRY_SECONDS;
