import { describe, expect, it } from "vitest";
import { resolveProviderRequestUrl } from "../src/modules/provider/adapters/provider-http-client.js";
import { BORZO_TEST_BASE_URL } from "../src/modules/provider/adapters/borzo/borzo.constants.js";

describe("resolveProviderRequestUrl", () => {
  it("appends Borzo operational paths under the configured base URL", () => {
    expect(
      resolveProviderRequestUrl(BORZO_TEST_BASE_URL, "/calculate-order"),
    ).toBe(`${BORZO_TEST_BASE_URL}/calculate-order`);
    expect(
      resolveProviderRequestUrl(BORZO_TEST_BASE_URL, "/create-order"),
    ).toBe(`${BORZO_TEST_BASE_URL}/create-order`);
  });

  it("returns the base URL for health-check requests", () => {
    expect(resolveProviderRequestUrl(BORZO_TEST_BASE_URL, "")).toBe(
      BORZO_TEST_BASE_URL,
    );
  });
});
