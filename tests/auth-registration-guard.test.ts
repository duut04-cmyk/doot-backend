import { describe, expect, it } from "vitest";
import { assertAppRegistrationEmail } from "../src/modules/auth/auth-registration-guard.js";

describe("assertAppRegistrationEmail", () => {
  it("allows normal signup emails", () => {
    expect(() => assertAppRegistrationEmail("user@gmail.com")).not.toThrow();
  });

  it("blocks @doot.test harness emails", () => {
    expect(() => assertAppRegistrationEmail("x@doot.test")).toThrow(
      /reserved for internal testing/i,
    );
  });
});
