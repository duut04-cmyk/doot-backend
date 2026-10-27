import { describe, expect, it } from "vitest";
import { evaluateProtectedApiRequest } from "../../admin-panel/src/lib/auth/apiRequestPolicy.ts";
import { CSRF_REJECTION_MESSAGE } from "../../admin-panel/src/lib/auth/csrf.ts";

function headers(map: Record<string, string>) {
  return {
    get(name: string): string | null {
      const key = Object.keys(map).find((k) => k.toLowerCase() === name.toLowerCase());
      return key ? map[key] : null;
    },
  };
}

describe("admin-panel API request policy (CSRF + session gate)", () => {
  it("rejects cross-origin PATCH before session check", () => {
    const decision = evaluateProtectedApiRequest({
      pathname: "/api/customers/00000000-0000-4000-8000-000000000001",
      method: "PATCH",
      headers: headers({
        host: "localhost:3000",
        origin: "https://attacker.example",
      }),
      hasSession: true,
    });
    expect(decision).toEqual({
      action: "reject",
      status: 403,
      error: CSRF_REJECTION_MESSAGE,
    });
  });

  it("rejects mutations with no Origin or Referer", () => {
    const decision = evaluateProtectedApiRequest({
      pathname: "/api/providers",
      method: "POST",
      headers: headers({ host: "localhost:3000" }),
      hasSession: false,
    });
    expect(decision.action).toBe("reject");
    expect(decision).toMatchObject({ status: 403 });
  });

  it("allows same-origin PATCH and enforces session", () => {
    const withoutSession = evaluateProtectedApiRequest({
      pathname: "/api/settings/policies",
      method: "PATCH",
      headers: headers({
        host: "localhost:3000",
        origin: "http://localhost:3000",
      }),
      hasSession: false,
    });
    expect(withoutSession).toEqual({
      action: "reject",
      status: 401,
      error: "Authentication required.",
    });

    const withSession = evaluateProtectedApiRequest({
      pathname: "/api/settings/policies",
      method: "PATCH",
      headers: headers({
        host: "localhost:3000",
        origin: "http://localhost:3000",
      }),
      hasSession: true,
    });
    expect(withSession).toEqual({ action: "next" });
  });

  it("allows same-origin login POST without session", () => {
    const decision = evaluateProtectedApiRequest({
      pathname: "/api/auth/login",
      method: "POST",
      headers: headers({
        host: "localhost:3000",
        origin: "http://localhost:3000",
      }),
      hasSession: false,
    });
    expect(decision).toEqual({ action: "next" });
  });

  it("does not apply CSRF to GET API routes", () => {
    const decision = evaluateProtectedApiRequest({
      pathname: "/api/customers",
      method: "GET",
      headers: headers({ host: "localhost:3000" }),
      hasSession: false,
    });
    expect(decision).toEqual({
      action: "reject",
      status: 401,
      error: "Authentication required.",
    });
  });

  it("allows representative mutating methods when same-origin and authenticated", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const decision = evaluateProtectedApiRequest({
        pathname: "/api/providers/00000000-0000-4000-8000-000000000010/credentials",
        method,
        headers: headers({
          host: "localhost:3000",
          origin: "http://localhost:3000",
        }),
        hasSession: true,
      });
      expect(decision).toEqual({ action: "next" });
    }
  });
});
