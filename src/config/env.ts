import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv({ override: false });

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

/**
 * Central environment configuration.
 *
 * Never log secrets or connection strings.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(5000),
    APP_NAME: z.preprocess(emptyToUndefined, z.string().min(1).default("Doot")),

    DATABASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    DIRECT_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),

    JWT_ACCESS_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
    JWT_ACCESS_EXPIRES_IN: z.preprocess(
      emptyToUndefined,
      z.string().min(1).default("15m"),
    ),
    // Reserved for future JWT refresh strategy; Part 2 uses opaque refresh tokens.
    JWT_REFRESH_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    REFRESH_TOKEN_EXPIRES_IN_DAYS: z.coerce.number().int().positive().default(30),
    PASSWORD_RESET_VERIFICATION_TOKEN_EXPIRY_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(600),

    RESEND_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    RESEND_FROM_EMAIL: z.preprocess(emptyToUndefined, z.string().email().optional()),
    EMAIL_FROM: z.preprocess(emptyToUndefined, z.string().email().optional()),

    BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

    GOOGLE_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    GOOGLE_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),

    FRONTEND_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    ADMIN_FRONTEND_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),

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

    BOOKING_QUOTE_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(300),

    BOOKING_PRICE_TOLERANCE_PERCENT: z.coerce.number().min(0).max(100).default(0),

    PLATFORM_SERVICE_FEE_PERCENT: z.coerce.number().int().min(0).max(100).default(10),

    OTP_EXPIRY_SECONDS: z.coerce.number().int().positive().default(600),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    OTP_GENERATION_COOLDOWN_SECONDS: z.coerce.number().int().nonnegative().default(60),

    MSG91_ENABLED: z
      .preprocess((value) => value === "true" || value === true, z.boolean())
      .optional()
      .default(false),

    MSG91_AUTH_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    MSG91_SENDER_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    MSG91_ACCOUNT_OTP_TEMPLATE_ID: z.preprocess(
      emptyToUndefined,
      z.string().min(1).optional(),
    ),
    MSG91_PICKUP_OTP_TEMPLATE_ID: z.preprocess(
      emptyToUndefined,
      z.string().min(1).optional(),
    ),
    MSG91_DELIVERY_OTP_TEMPLATE_ID: z.preprocess(
      emptyToUndefined,
      z.string().min(1).optional(),
    ),
    /** @deprecated Use MSG91_PICKUP_OTP_TEMPLATE_ID */
    MSG91_PICKUP_OTP_FLOW_ID: z.preprocess(
      emptyToUndefined,
      z.string().min(1).optional(),
    ),
    /** @deprecated Use MSG91_DELIVERY_OTP_TEMPLATE_ID */
    MSG91_DELIVERY_OTP_FLOW_ID: z.preprocess(
      emptyToUndefined,
      z.string().min(1).optional(),
    ),
    MSG91_API_BASE_URL: z.preprocess(
      emptyToUndefined,
      z.string().url().default("https://api.msg91.com/api/v5"),
    ),
    MSG91_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),

    /** Operational pickup/delivery OTP SMS: mock (disabled), msg91, or twilio. */
    SMS_PROVIDER: z
      .preprocess(
        (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
        z.enum(["mock", "msg91", "twilio"]).default("msg91"),
      )
      .optional()
      .default("msg91"),

    TWILIO_ACCOUNT_SID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    TWILIO_AUTH_TOKEN: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    TWILIO_FROM_NUMBER: z.preprocess(emptyToUndefined, z.string().min(1).optional()),

    /**
     * Non-production only: send pickup/drop OTP SMS to this number instead of delivery contacts
     * (e.g. Twilio trial verified handset). Ignored when NODE_ENV=production.
     */
    SMS_OTP_RECIPIENT_OVERRIDE: z.preprocess(
      emptyToUndefined,
      z.string().min(1).optional(),
    ),

    OPERATIONAL_POLLING_ENABLED: z
      .preprocess((value) => value === "true" || value === true, z.boolean())
      .optional()
      .default(false),

    OPERATIONAL_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),

    OPERATIONAL_POLL_BATCH_SIZE: z.coerce.number().int().positive().default(50),

    /** Customer track-page happy-path simulator (MOCK bookings only; never use in production). */
    ENABLE_DEV_DELIVERY_SIMULATE: z
      .preprocess((value) => value === "true" || value === true, z.boolean())
      .optional()
      .default(false),

    /**
     * MSG91 smoke route POST /api/v1/test/sms (non-production only).
     * Default false — opt in explicitly for local testing.
     */
    ENABLE_TEST_SMS_ENDPOINT: z
      .preprocess((value) => value === "true" || value === true, z.boolean())
      .optional()
      .default(false),

    /**
     * Certification scripts only: include `_testOtp` in OTP API responses.
     * Never enable in production.
     */
    EXPOSE_OTP_FOR_CERTIFICATION: z
      .preprocess((value) => value === "true" || value === true, z.boolean())
      .optional()
      .default(false),

    /** Wall-clock budget for evaluating all providers during orchestration (ms). */
    ORCHESTRATION_MAX_DURATION_MS: z.coerce.number().int().positive().optional(),

    /**
     * When true (non-production), only evaluate the MOCK provider during orchestration.
     * Speeds local create-flow quotes; never enable in production.
     */
    ORCHESTRATION_MOCK_ONLY: z
      .preprocess((value) => value === "true" || value === true, z.boolean())
      .optional()
      .default(false),

    /**
     * When set, providers matching this `Provider.code` are evaluated first.
     * Fallback providers run only if the preferred tier yields no ELIGIBLE options
     * and no fail-fast ERROR (auth/config/validation).
     */
    ORCHESTRATION_PREFERRED_PROVIDER_CODE: z.preprocess(
      emptyToUndefined,
      z.string().min(1).optional(),
    ),

    SHIPROCKET_ENABLED: z
      .preprocess((value) => value === "true" || value === true, z.boolean())
      .optional()
      .default(false),

    SHIPROCKET_API_BASE_URL: z.preprocess(
      emptyToUndefined,
      z.string().url().optional().default("https://api-sandbox.shiprocket.in"),
    ),

    SHIPROCKET_AUTH_EMAIL: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    SHIPROCKET_AUTH_PASSWORD: z.preprocess(
      emptyToUndefined,
      z.string().min(1).optional(),
    ),

    /** Server-only Google Geocoding API key (reverse geocode lat/lng → postal_code). */
    GOOGLE_GEOCODING_API_KEY: z.preprocess(
      emptyToUndefined,
      z.string().min(1).optional(),
    ),

    /**
     * When true, Shiprocket adapter exposes booking/cancel/tracking operations.
     * Default false until sandbox contracts are verified.
     */
    SHIPROCKET_BOOKING_ENABLED: z
      .preprocess((value) => value === "true" || value === true, z.boolean())
      .optional()
      .default(false),

    /** Pickup location name configured in the Shiprocket account (required for adhoc orders). */
    SHIPROCKET_PICKUP_LOCATION: z.preprocess(
      emptyToUndefined,
      z.string().min(1).optional(),
    ),

    SHIPROCKET_WEBHOOK_ENABLED: z
      .preprocess((value) => value === "true" || value === true, z.boolean())
      .optional()
      .default(false),

    SHIPROCKET_WEBHOOK_API_KEY: z.preprocess(
      emptyToUndefined,
      z.string().min(1).optional(),
    ),

    /** Active payment gateway: stub (default) or cashfree */
    PAYMENT_GATEWAY: z
      .preprocess(
        (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
        z.enum(["stub", "cashfree"]).default("stub"),
      )
      .optional()
      .default("stub"),

    CASHFREE_ENABLED: z
      .preprocess((value) => value === "true" || value === true, z.boolean())
      .optional()
      .default(false),

    CASHFREE_ENVIRONMENT: z
      .preprocess(
        (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
        z.enum(["sandbox", "production"]).default("sandbox"),
      )
      .optional()
      .default("sandbox"),

    CASHFREE_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    CASHFREE_CLIENT_SECRET: z.preprocess(
      emptyToUndefined,
      z.string().min(1).optional(),
    ),
    CASHFREE_API_VERSION: z.preprocess(
      emptyToUndefined,
      z.string().min(1).default("2025-01-01"),
    ),
    CASHFREE_RETURN_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    CASHFREE_NOTIFY_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    CASHFREE_WEBHOOK_ENABLED: z
      .preprocess((value) => value === "true" || value === true, z.boolean())
      .optional()
      .default(false),

    /** Cloudflare R2 (S3-compatible) for delivery package photos */
    R2_ACCOUNT_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    R2_ACCESS_KEY_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    R2_SECRET_ACCESS_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    R2_BUCKET_NAME: z.preprocess(emptyToUndefined, z.string().min(1).default("doot")),
    /** Public bucket URL or custom domain (no trailing slash), e.g. https://pub-xxxx.r2.dev */
    R2_PUBLIC_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
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

    if (data.SMS_OTP_RECIPIENT_OVERRIDE && data.NODE_ENV === "production") {
      ctx.addIssue({
        code: "custom",
        path: ["SMS_OTP_RECIPIENT_OVERRIDE"],
        message: "SMS_OTP_RECIPIENT_OVERRIDE is not allowed in production",
      });
    }

    if (data.NODE_ENV === "production") {
      if (data.PAYMENT_GATEWAY === "stub") {
        ctx.addIssue({
          code: "custom",
          path: ["PAYMENT_GATEWAY"],
          message:
            "PAYMENT_GATEWAY=stub is not allowed in production; set PAYMENT_GATEWAY=cashfree with Cashfree credentials",
        });
      }
      if (data.SMS_PROVIDER === "mock") {
        ctx.addIssue({
          code: "custom",
          path: ["SMS_PROVIDER"],
          message:
            "SMS_PROVIDER=mock is not allowed in production; configure msg91 or twilio with credentials",
        });
      }
      if (data.ENABLE_MOCK_PROVIDER_ADAPTER) {
        ctx.addIssue({
          code: "custom",
          path: ["ENABLE_MOCK_PROVIDER_ADAPTER"],
          message: "ENABLE_MOCK_PROVIDER_ADAPTER must be false in production",
        });
      }
      if (data.ENABLE_DEV_DELIVERY_SIMULATE) {
        ctx.addIssue({
          code: "custom",
          path: ["ENABLE_DEV_DELIVERY_SIMULATE"],
          message: "ENABLE_DEV_DELIVERY_SIMULATE must be false in production",
        });
      }
      if (data.EXPOSE_OTP_FOR_CERTIFICATION) {
        ctx.addIssue({
          code: "custom",
          path: ["EXPOSE_OTP_FOR_CERTIFICATION"],
          message: "EXPOSE_OTP_FOR_CERTIFICATION must be false in production",
        });
      }
      if (data.ORCHESTRATION_MOCK_ONLY) {
        ctx.addIssue({
          code: "custom",
          path: ["ORCHESTRATION_MOCK_ONLY"],
          message: "ORCHESTRATION_MOCK_ONLY must be false in production",
        });
      }
    }

    if (data.SMS_PROVIDER === "twilio" && data.NODE_ENV !== "test") {
      const twilioFields = [
        ["TWILIO_ACCOUNT_SID", data.TWILIO_ACCOUNT_SID],
        ["TWILIO_AUTH_TOKEN", data.TWILIO_AUTH_TOKEN],
        ["TWILIO_FROM_NUMBER", data.TWILIO_FROM_NUMBER],
      ] as const;
      for (const [field, value] of twilioFields) {
        if (!value) {
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: `${field} is required when SMS_PROVIDER is twilio`,
          });
        }
      }
    }

    if (data.MSG91_ENABLED && data.NODE_ENV !== "test") {
      const pickupTemplateId =
        data.MSG91_PICKUP_OTP_TEMPLATE_ID ?? data.MSG91_PICKUP_OTP_FLOW_ID;
      const deliveryTemplateId =
        data.MSG91_DELIVERY_OTP_TEMPLATE_ID ?? data.MSG91_DELIVERY_OTP_FLOW_ID;

      const requiredMsg91Fields = [
        ["MSG91_AUTH_KEY", data.MSG91_AUTH_KEY],
        ["MSG91_SENDER_ID", data.MSG91_SENDER_ID],
        ["MSG91_PICKUP_OTP_TEMPLATE_ID", pickupTemplateId],
        ["MSG91_DELIVERY_OTP_TEMPLATE_ID", deliveryTemplateId],
        ["MSG91_API_BASE_URL", data.MSG91_API_BASE_URL],
      ] as const;

      for (const [field, value] of requiredMsg91Fields) {
        if (!value) {
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: `${field} is required when MSG91_ENABLED is true`,
          });
        }
      }
    }

    if (data.SMS_PROVIDER === "msg91" && data.NODE_ENV === "production") {
      if (!data.MSG91_ENABLED) {
        ctx.addIssue({
          code: "custom",
          path: ["MSG91_ENABLED"],
          message:
            "MSG91_ENABLED must be true when SMS_PROVIDER is msg91 in production",
        });
      }

      const pickupTemplateId =
        data.MSG91_PICKUP_OTP_TEMPLATE_ID ?? data.MSG91_PICKUP_OTP_FLOW_ID;
      const deliveryTemplateId =
        data.MSG91_DELIVERY_OTP_TEMPLATE_ID ?? data.MSG91_DELIVERY_OTP_FLOW_ID;

      const requiredMsg91OperationalFields = [
        ["MSG91_AUTH_KEY", data.MSG91_AUTH_KEY],
        ["MSG91_SENDER_ID", data.MSG91_SENDER_ID],
        ["MSG91_PICKUP_OTP_TEMPLATE_ID", pickupTemplateId],
        ["MSG91_DELIVERY_OTP_TEMPLATE_ID", deliveryTemplateId],
        ["MSG91_API_BASE_URL", data.MSG91_API_BASE_URL],
      ] as const;

      for (const [field, value] of requiredMsg91OperationalFields) {
        if (!value) {
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: `${field} is required when SMS_PROVIDER is msg91 in production`,
          });
        }
      }
    }

    if (data.SHIPROCKET_ENABLED && data.NODE_ENV !== "test") {
      const allowedShiprocketHosts = new Set([
        "api-sandbox.shiprocket.in",
        "apiv2.shiprocket.in",
      ]);
      let shiprocketHost: string | null;
      try {
        shiprocketHost = new URL(data.SHIPROCKET_API_BASE_URL).hostname.toLowerCase();
      } catch {
        shiprocketHost = null;
      }
      if (!shiprocketHost || !allowedShiprocketHosts.has(shiprocketHost)) {
        ctx.addIssue({
          code: "custom",
          path: ["SHIPROCKET_API_BASE_URL"],
          message:
            "SHIPROCKET_API_BASE_URL must be an allowed Shiprocket host when SHIPROCKET_ENABLED is true",
        });
      }
      if (!data.SHIPROCKET_AUTH_EMAIL) {
        ctx.addIssue({
          code: "custom",
          path: ["SHIPROCKET_AUTH_EMAIL"],
          message: "SHIPROCKET_AUTH_EMAIL is required when SHIPROCKET_ENABLED is true",
        });
      }
      if (!data.SHIPROCKET_AUTH_PASSWORD) {
        ctx.addIssue({
          code: "custom",
          path: ["SHIPROCKET_AUTH_PASSWORD"],
          message:
            "SHIPROCKET_AUTH_PASSWORD is required when SHIPROCKET_ENABLED is true",
        });
      }
    }

    if (data.SHIPROCKET_BOOKING_ENABLED && data.NODE_ENV !== "test") {
      if (!data.SHIPROCKET_ENABLED) {
        ctx.addIssue({
          code: "custom",
          path: ["SHIPROCKET_BOOKING_ENABLED"],
          message:
            "SHIPROCKET_ENABLED must be true when SHIPROCKET_BOOKING_ENABLED is true",
        });
      }
      if (!data.SHIPROCKET_PICKUP_LOCATION) {
        ctx.addIssue({
          code: "custom",
          path: ["SHIPROCKET_PICKUP_LOCATION"],
          message:
            "SHIPROCKET_PICKUP_LOCATION is required when SHIPROCKET_BOOKING_ENABLED is true",
        });
      }
    }

    if (data.SHIPROCKET_WEBHOOK_ENABLED && data.NODE_ENV !== "test") {
      if (!data.SHIPROCKET_WEBHOOK_API_KEY) {
        ctx.addIssue({
          code: "custom",
          path: ["SHIPROCKET_WEBHOOK_API_KEY"],
          message:
            "SHIPROCKET_WEBHOOK_API_KEY is required when SHIPROCKET_WEBHOOK_ENABLED is true",
        });
      }
    }

    const cashfreeSelected =
      data.PAYMENT_GATEWAY === "cashfree" || data.CASHFREE_ENABLED;
    if (cashfreeSelected && data.NODE_ENV !== "test") {
      if (!data.CASHFREE_CLIENT_ID) {
        ctx.addIssue({
          code: "custom",
          path: ["CASHFREE_CLIENT_ID"],
          message:
            "CASHFREE_CLIENT_ID is required when PAYMENT_GATEWAY=cashfree or CASHFREE_ENABLED=true",
        });
      }
      if (!data.CASHFREE_CLIENT_SECRET) {
        ctx.addIssue({
          code: "custom",
          path: ["CASHFREE_CLIENT_SECRET"],
          message:
            "CASHFREE_CLIENT_SECRET is required when PAYMENT_GATEWAY=cashfree or CASHFREE_ENABLED=true",
        });
      }
      if (data.CASHFREE_ENVIRONMENT === "production") {
        ctx.addIssue({
          code: "custom",
          path: ["CASHFREE_ENVIRONMENT"],
          message:
            "Cashfree production is not enabled; use CASHFREE_ENVIRONMENT=sandbox",
        });
      }
      if (data.PAYMENT_GATEWAY === "cashfree" && !data.CASHFREE_ENABLED) {
        ctx.addIssue({
          code: "custom",
          path: ["CASHFREE_ENABLED"],
          message: "CASHFREE_ENABLED must be true when PAYMENT_GATEWAY=cashfree",
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/** @internal Exported for configuration regression tests only. */
export { envSchema };

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  const data = parsed.data;
  const orchestrationMaxDurationMs =
    data.ORCHESTRATION_MAX_DURATION_MS ??
    (data.NODE_ENV === "production" ? 45_000 : 8_000);

  return {
    ...data,
    ORCHESTRATION_MAX_DURATION_MS: orchestrationMaxDurationMs,
  };
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

export const DEFAULT_BOOKING_QUOTE_MAX_AGE_SECONDS = env.BOOKING_QUOTE_MAX_AGE_SECONDS;

export const DEFAULT_BOOKING_PRICE_TOLERANCE_PERCENT =
  env.BOOKING_PRICE_TOLERANCE_PERCENT;

export const OTP_EXPIRY_SECONDS = env.OTP_EXPIRY_SECONDS;
export const OTP_MAX_ATTEMPTS = env.OTP_MAX_ATTEMPTS;
export const OTP_GENERATION_COOLDOWN_SECONDS = env.OTP_GENERATION_COOLDOWN_SECONDS;

export const PASSWORD_RESET_VERIFICATION_TOKEN_EXPIRY_SECONDS =
  env.PASSWORD_RESET_VERIFICATION_TOKEN_EXPIRY_SECONDS;

export function getMsg91AccountTemplateId(): string | undefined {
  return env.MSG91_ACCOUNT_OTP_TEMPLATE_ID;
}

export function getMsg91PickupTemplateId(): string | undefined {
  return env.MSG91_PICKUP_OTP_TEMPLATE_ID ?? env.MSG91_PICKUP_OTP_FLOW_ID;
}

export function getMsg91DeliveryTemplateId(): string | undefined {
  return env.MSG91_DELIVERY_OTP_TEMPLATE_ID ?? env.MSG91_DELIVERY_OTP_FLOW_ID;
}

export function isTwilioConfigured(): boolean {
  return Boolean(
    env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER,
  );
}

/** True when operational SMS is enabled for the configured provider. */
export function isOperationalSmsEnabled(): boolean {
  switch (env.SMS_PROVIDER) {
    case "mock":
      return false;
    case "twilio":
      return isTwilioConfigured();
    case "msg91":
      return env.MSG91_ENABLED === true && isMsg91Configured();
    default:
      return false;
  }
}

/** True when pickup/delivery OTP SMS can be sent via MSG91. */
export function isMsg91Configured(): boolean {
  return Boolean(
    env.MSG91_AUTH_KEY &&
    env.MSG91_SENDER_ID &&
    getMsg91PickupTemplateId() &&
    getMsg91DeliveryTemplateId() &&
    env.MSG91_API_BASE_URL,
  );
}

export function isMsg91AccountTemplateConfigured(): boolean {
  return Boolean(getMsg91AccountTemplateId());
}

export function getCashfreePgBaseUrl(): string {
  if (env.CASHFREE_ENVIRONMENT === "production") {
    return "https://api.cashfree.com/pg";
  }
  return "https://sandbox.cashfree.com/pg";
}

export function isCashfreeConfigured(): boolean {
  return Boolean(
    env.CASHFREE_ENABLED &&
    env.CASHFREE_CLIENT_ID &&
    env.CASHFREE_CLIENT_SECRET &&
    env.CASHFREE_ENVIRONMENT === "sandbox",
  );
}

export function requireShiprocketWebhookApiKey(): string {
  if (!env.SHIPROCKET_WEBHOOK_ENABLED) {
    throw new Error("SHIPROCKET_WEBHOOK_ENABLED is false");
  }
  if (!env.SHIPROCKET_WEBHOOK_API_KEY) {
    throw new Error("SHIPROCKET_WEBHOOK_API_KEY is not configured");
  }
  return env.SHIPROCKET_WEBHOOK_API_KEY;
}

export function requireCashfreeCredentials(): {
  clientId: string;
  clientSecret: string;
  apiVersion: string;
} {
  if (!env.CASHFREE_ENABLED) {
    throw new Error("CASHFREE_ENABLED is false");
  }
  if (env.CASHFREE_ENVIRONMENT !== "sandbox") {
    throw new Error("Cashfree production is not enabled in Phase 2A");
  }
  if (!env.CASHFREE_CLIENT_ID || !env.CASHFREE_CLIENT_SECRET) {
    throw new Error("Cashfree client credentials are not configured");
  }
  return {
    clientId: env.CASHFREE_CLIENT_ID,
    clientSecret: env.CASHFREE_CLIENT_SECRET,
    apiVersion: env.CASHFREE_API_VERSION,
  };
}

export function isObjectStorageConfigured(): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID?.trim() &&
    env.R2_ACCESS_KEY_ID?.trim() &&
    env.R2_SECRET_ACCESS_KEY?.trim(),
  );
}

/** Backend can attach photo URLs when public base or signed-read credentials exist. */
export function canResolvePackagePhotoUrls(): boolean {
  return Boolean(env.R2_PUBLIC_BASE_URL?.trim()) || isObjectStorageConfigured();
}
