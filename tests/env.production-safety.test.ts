import { describe, expect, it } from "vitest";
import { envSchema } from "../src/config/env.js";
import { baseSafeProductionEnv } from "./helpers/safe-production-env.js";

describe("production environment safety", () => {
  it("accepts a minimal safe production configuration", () => {
    const parsed = envSchema.safeParse(baseSafeProductionEnv);
    expect(parsed.success).toBe(true);
  });

  it("rejects PAYMENT_GATEWAY=stub in production", () => {
    const parsed = envSchema.safeParse({
      ...baseSafeProductionEnv,
      PAYMENT_GATEWAY: "stub",
      CASHFREE_ENABLED: "false",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((issue) => issue.path.includes("PAYMENT_GATEWAY")),
      ).toBe(true);
    }
  });

  it("rejects default stub payment when PAYMENT_GATEWAY is omitted in production", () => {
    const { PAYMENT_GATEWAY: _omit, ...withoutGateway } = baseSafeProductionEnv;
    const parsed = envSchema.safeParse(withoutGateway);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((issue) => issue.path.includes("PAYMENT_GATEWAY")),
      ).toBe(true);
    }
  });

  it("rejects SMS_PROVIDER=mock in production", () => {
    const parsed = envSchema.safeParse({
      ...baseSafeProductionEnv,
      SMS_PROVIDER: "mock",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((issue) => issue.path.includes("SMS_PROVIDER")),
      ).toBe(true);
    }
  });

  it("rejects ENABLE_MOCK_PROVIDER_ADAPTER in production", () => {
    const parsed = envSchema.safeParse({
      ...baseSafeProductionEnv,
      ENABLE_MOCK_PROVIDER_ADAPTER: "true",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((issue) =>
          issue.path.includes("ENABLE_MOCK_PROVIDER_ADAPTER"),
        ),
      ).toBe(true);
    }
  });

  it("rejects ENABLE_DEV_DELIVERY_SIMULATE in production", () => {
    const parsed = envSchema.safeParse({
      ...baseSafeProductionEnv,
      ENABLE_DEV_DELIVERY_SIMULATE: "true",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((issue) =>
          issue.path.includes("ENABLE_DEV_DELIVERY_SIMULATE"),
        ),
      ).toBe(true);
    }
  });

  it("rejects EXPOSE_OTP_FOR_CERTIFICATION in production", () => {
    const parsed = envSchema.safeParse({
      ...baseSafeProductionEnv,
      EXPOSE_OTP_FOR_CERTIFICATION: "true",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((issue) =>
          issue.path.includes("EXPOSE_OTP_FOR_CERTIFICATION"),
        ),
      ).toBe(true);
    }
  });

  it("requires MSG91 operational fields when SMS_PROVIDER is msg91 in production", () => {
    const parsed = envSchema.safeParse({
      ...baseSafeProductionEnv,
      SMS_PROVIDER: "msg91",
      MSG91_ENABLED: "true",
      TWILIO_ACCOUNT_SID: undefined,
      TWILIO_AUTH_TOKEN: undefined,
      TWILIO_FROM_NUMBER: undefined,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((issue) => issue.path.includes("MSG91_AUTH_KEY")),
      ).toBe(true);
    }
  });

  it("rejects SMS_PROVIDER=msg91 in production when MSG91_ENABLED is false or omitted", () => {
    for (const msg91Enabled of [undefined, "false"] as const) {
      const parsed = envSchema.safeParse({
        ...baseSafeProductionEnv,
        SMS_PROVIDER: "msg91",
        MSG91_ENABLED: msg91Enabled,
        MSG91_AUTH_KEY: "key",
        MSG91_SENDER_ID: "DOOT",
        MSG91_PICKUP_OTP_TEMPLATE_ID: "pickup",
        MSG91_DELIVERY_OTP_TEMPLATE_ID: "delivery",
        MSG91_API_BASE_URL: "https://api.msg91.com/api/v5",
        TWILIO_ACCOUNT_SID: undefined,
        TWILIO_AUTH_TOKEN: undefined,
        TWILIO_FROM_NUMBER: undefined,
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(
          parsed.error.issues.some((issue) => issue.path.includes("MSG91_ENABLED")),
        ).toBe(true);
      }
    }
  });

  it("accepts valid MSG91 configuration in production", () => {
    const parsed = envSchema.safeParse({
      ...baseSafeProductionEnv,
      SMS_PROVIDER: "msg91",
      MSG91_ENABLED: "true",
      MSG91_AUTH_KEY: "key",
      MSG91_SENDER_ID: "DOOT",
      MSG91_PICKUP_OTP_TEMPLATE_ID: "pickup",
      MSG91_DELIVERY_OTP_TEMPLATE_ID: "delivery",
      MSG91_API_BASE_URL: "https://api.msg91.com/api/v5",
      TWILIO_ACCOUNT_SID: undefined,
      TWILIO_AUTH_TOKEN: undefined,
      TWILIO_FROM_NUMBER: undefined,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects ORCHESTRATION_MOCK_ONLY in production", () => {
    const parsed = envSchema.safeParse({
      ...baseSafeProductionEnv,
      ORCHESTRATION_MOCK_ONLY: "true",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((issue) =>
          issue.path.includes("ORCHESTRATION_MOCK_ONLY"),
        ),
      ).toBe(true);
    }
  });

  it("allows intentional mock/stub configuration in test", () => {
    const parsed = envSchema.safeParse({
      NODE_ENV: "test",
      PAYMENT_GATEWAY: "stub",
      SMS_PROVIDER: "mock",
      ENABLE_MOCK_PROVIDER_ADAPTER: "true",
      ENABLE_DEV_DELIVERY_SIMULATE: "true",
      EXPOSE_OTP_FOR_CERTIFICATION: "true",
    });
    expect(parsed.success).toBe(true);
  });
});
