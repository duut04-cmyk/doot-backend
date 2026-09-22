import { describe, expect, it } from "vitest";
import { resolveProviderRequestUrl } from "../src/modules/provider/adapters/provider-http-client.js";

const MOCK_SANDBOX_BASE_URL = "https://mock-provider.test/sandbox";

describe("resolveProviderRequestUrl", () => {
  it("appends provider operational paths under the configured base URL", () => {
    expect(resolveProviderRequestUrl(MOCK_SANDBOX_BASE_URL, "/quotes")).toBe(
      `${MOCK_SANDBOX_BASE_URL}/quotes`,
    );
    expect(resolveProviderRequestUrl(MOCK_SANDBOX_BASE_URL, "/bookings")).toBe(
      `${MOCK_SANDBOX_BASE_URL}/bookings`,
    );
  });

  it("returns the base URL for health-check requests", () => {
    expect(resolveProviderRequestUrl(MOCK_SANDBOX_BASE_URL, "")).toBe(
      MOCK_SANDBOX_BASE_URL,
    );
  });
});
