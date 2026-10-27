import { describe, expect, it } from "vitest";
import {
  accessTokenCookieOptions,
  clearAccessTokenCookieOptions,
} from "../../admin-panel/src/lib/auth/cookies.ts";
import {
  hasAdminSessionCookie,
  isPublicApiPath,
  isPublicPagePath,
} from "../../admin-panel/src/lib/auth/routes.ts";

describe("admin-panel auth helpers", () => {
  it("marks public pages and protects others", () => {
    expect(isPublicPagePath("/")).toBe(true);
    expect(isPublicPagePath("/login")).toBe(true);
    expect(isPublicPagePath("/overview")).toBe(false);
    expect(isPublicPagePath("/customers/abc")).toBe(false);
  });

  it("allows only auth login/logout API routes without a session", () => {
    expect(isPublicApiPath("/api/auth/login")).toBe(true);
    expect(isPublicApiPath("/api/auth/logout")).toBe(true);
    expect(isPublicApiPath("/api/customers")).toBe(false);
    expect(isPublicApiPath("/api/deliveries")).toBe(false);
  });

  it("detects admin session cookie presence from Cookie header", () => {
    expect(hasAdminSessionCookie(null)).toBe(false);
    expect(
      hasAdminSessionCookie("other=1; doot_admin_access_token=abc123; foo=bar"),
    ).toBe(true);
  });

  it("sets secure httpOnly cookie options for session and logout clearing", () => {
    const session = accessTokenCookieOptions(900);
    expect(session.httpOnly).toBe(true);
    expect(session.sameSite).toBe("lax");
    expect(session.path).toBe("/");
    expect(session.maxAge).toBe(900);

    const cleared = clearAccessTokenCookieOptions();
    expect(cleared.httpOnly).toBe(true);
    expect(cleared.maxAge).toBe(0);
  });
});
