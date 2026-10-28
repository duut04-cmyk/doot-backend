import { describe, expect, it } from "vitest";
import { envSchema } from "../src/config/env.js";
import { baseSafeProductionEnv } from "./helpers/safe-production-env.js";

const baseProductionEnv = {
  ...baseSafeProductionEnv,
  SHIPROCKET_ENABLED: "true",
  SHIPROCKET_API_BASE_URL: "https://api-sandbox.shiprocket.in",
  SHIPROCKET_AUTH_EMAIL: "sandbox@example.com",
  SHIPROCKET_AUTH_PASSWORD: "secret",
};

describe("Shiprocket environment validation", () => {
  it("defaults SHIPROCKET_BOOKING_ENABLED to false", () => {
    const parsed = envSchema.safeParse({
      NODE_ENV: "test",
      JWT_ACCESS_SECRET: "x".repeat(32),
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.SHIPROCKET_BOOKING_ENABLED).toBe(false);
      expect(parsed.data.OPERATIONAL_POLLING_ENABLED).toBe(false);
    }
  });

  it("requires SHIPROCKET_PICKUP_LOCATION when booking is enabled in production", () => {
    const parsed = envSchema.safeParse({
      ...baseProductionEnv,
      SHIPROCKET_BOOKING_ENABLED: "true",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((issue) =>
          issue.path.includes("SHIPROCKET_PICKUP_LOCATION"),
        ),
      ).toBe(true);
    }
  });

  it("accepts booking configuration when pickup location is set", () => {
    const parsed = envSchema.safeParse({
      ...baseProductionEnv,
      SHIPROCKET_BOOKING_ENABLED: "true",
      SHIPROCKET_PICKUP_LOCATION: "Doot Warehouse",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects untrusted Shiprocket API hosts when enabled", () => {
    const parsed = envSchema.safeParse({
      ...baseProductionEnv,
      SHIPROCKET_API_BASE_URL: "https://evil.example.com",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((issue) =>
          issue.path.includes("SHIPROCKET_API_BASE_URL"),
        ),
      ).toBe(true);
    }
  });
});
