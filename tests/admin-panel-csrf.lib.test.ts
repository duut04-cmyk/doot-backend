import { describe, expect, it } from "vitest";
import {
  CSRF_REJECTION_MESSAGE,
  isSameOriginMutation,
  isSameOriginPost,
} from "../../admin-panel/src/lib/auth/csrf.ts";

function headers(map: Record<string, string>) {
  return {
    get(name: string): string | null {
      const key = Object.keys(map).find((k) => k.toLowerCase() === name.toLowerCase());
      return key ? map[key] : null;
    },
  };
}

describe("admin-panel CSRF helpers", () => {
  it("accepts matching Origin and Host", () => {
    expect(
      isSameOriginMutation(
        headers({ host: "localhost:3000", origin: "http://localhost:3000" }),
      ),
    ).toBe(true);
  });

  it("accepts Referer when Origin is absent", () => {
    expect(
      isSameOriginMutation(
        headers({
          host: "admin.example.com",
          referer: "https://admin.example.com/customers",
        }),
      ),
    ).toBe(true);
  });

  it("rejects cross-origin Origin", () => {
    expect(
      isSameOriginMutation(
        headers({ host: "localhost:3000", origin: "https://evil.example" }),
      ),
    ).toBe(false);
  });

  it("rejects cross-origin Referer when Origin is absent", () => {
    expect(
      isSameOriginMutation(
        headers({
          host: "localhost:3000",
          referer: "https://evil.example/phish",
        }),
      ),
    ).toBe(false);
  });

  it("rejects missing Origin and Referer", () => {
    expect(isSameOriginMutation(headers({ host: "localhost:3000" }))).toBe(false);
  });

  it("rejects missing Host", () => {
    expect(isSameOriginMutation(headers({ origin: "http://localhost:3000" }))).toBe(
      false,
    );
  });

  it("rejects malformed Origin URL", () => {
    expect(
      isSameOriginMutation(headers({ host: "localhost:3000", origin: "not-a-url" })),
    ).toBe(false);
  });

  it("isSameOriginPost delegates to isSameOriginMutation", () => {
    const request = {
      headers: headers({ host: "localhost:3000", origin: "http://localhost:3000" }),
    } as Request;
    expect(isSameOriginPost(request)).toBe(true);
  });

  it("exports a stable rejection message", () => {
    expect(CSRF_REJECTION_MESSAGE).toBe("Invalid request.");
  });
});
