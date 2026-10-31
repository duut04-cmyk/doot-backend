import { describe, expect, it } from "vitest";
import {
  readJwtExpHintEpochSeconds,
  resolveShiprocketTokenExpiresAt,
  shouldRefreshShiprocketToken,
} from "../src/modules/provider/adapters/shiprocket/shiprocket-token-expiry.util.js";
import { SHIPROCKET_TOKEN_REFRESH_IF_REMAINING_MS } from "../src/modules/provider/adapters/shiprocket/shiprocket.constants.js";

describe("shiprocket token expiry", () => {
  it("uses explicit expiry from login body when present", () => {
    const issuedAt = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = resolveShiprocketTokenExpiresAt({
      loginBody: { expires_at: "2026-01-15T00:00:00.000Z" },
      token: "opaque-token",
      issuedAt,
    });
    expect(expiresAt.toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });

  it("uses JWT exp hint when explicit expiry is absent", () => {
    const issuedAt = new Date("2026-01-01T00:00:00.000Z");
    const exp = Math.floor(new Date("2026-01-12T00:00:00.000Z").getTime() / 1000);
    const payload = Buffer.from(JSON.stringify({ exp }), "utf8").toString("base64url");
    const token = `header.${payload}.sig`;
    expect(readJwtExpHintEpochSeconds(token)).toBe(exp);
    const expiresAt = resolveShiprocketTokenExpiresAt({
      loginBody: { token },
      token,
      issuedAt,
    });
    expect(expiresAt.toISOString()).toBe("2026-01-12T00:00:00.000Z");
  });

  it("falls back to documented ~10 day lifetime", () => {
    const issuedAt = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = resolveShiprocketTokenExpiresAt({
      loginBody: { token: "opaque" },
      token: "opaque",
      issuedAt,
    });
    expect(expiresAt.getTime() - issuedAt.getTime()).toBe(10 * 24 * 60 * 60 * 1000);
  });

  it("refreshes when remaining validity is 24 hours or less", () => {
    const expiresAt = new Date("2026-01-10T12:00:00.000Z");
    const now = new Date("2026-01-09T12:00:00.000Z");
    expect(
      shouldRefreshShiprocketToken(
        expiresAt,
        now,
        SHIPROCKET_TOKEN_REFRESH_IF_REMAINING_MS,
      ),
    ).toBe(true);
    const earlier = new Date("2026-01-08T00:00:00.000Z");
    expect(
      shouldRefreshShiprocketToken(
        expiresAt,
        earlier,
        SHIPROCKET_TOKEN_REFRESH_IF_REMAINING_MS,
      ),
    ).toBe(false);
  });
});
