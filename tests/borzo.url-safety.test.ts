import { describe, expect, it } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import {
  resolveTrustedProviderBaseUrl,
  validateTrustedUrl,
} from "../src/modules/provider/adapters/provider.adapter-urls.js";
import { assertBorzoPhase4Environment } from "../src/modules/provider/adapters/borzo/borzo.mapper.js";
import { BORZO_TEST_BASE_URL } from "../src/modules/provider/adapters/borzo/borzo.constants.js";

describe("Borzo URL safety", () => {
  it("allowlists Borzo TEST base URL for SANDBOX", () => {
    const url = resolveTrustedProviderBaseUrl("BORZO", "SANDBOX");
    expect(url).toBe(BORZO_TEST_BASE_URL);
    expect(new URL(url).hostname).toBe("robotapitest-in.borzodelivery.com");
  });

  it("rejects Borzo LIVE URL in Phase 4 allowlist", () => {
    expect(() => resolveTrustedProviderBaseUrl("BORZO", "LIVE")).toThrow(
      expect.objectContaining({
        code: ErrorCodes.PROVIDER_CONFIGURATION_INVALID,
      }),
    );
  });

  it("rejects localhost provider URLs", () => {
    expect(() => validateTrustedUrl("http://localhost/api")).toThrow(
      expect.objectContaining({
        code: ErrorCodes.PROVIDER_CONFIGURATION_INVALID,
      }),
    );
  });

  it("blocks production Borzo environment in adapter guard", () => {
    expect(() =>
      assertBorzoPhase4Environment("LIVE", BORZO_TEST_BASE_URL),
    ).toThrow("Production Borzo is not enabled in Phase 4.");
  });

  it("blocks unexpected Borzo host", () => {
    expect(() =>
      assertBorzoPhase4Environment(
        "SANDBOX",
        "https://robot-in.borzodelivery.com/api/business/1.8",
      ),
    ).toThrow("Borzo base URL host is not allowed for Phase 4.");
  });
});
