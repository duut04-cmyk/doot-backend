import { describe, expect, it } from "vitest";
import { isInternalTestCustomerEmail } from "../src/modules/customer/customer-test-users.js";

describe("isInternalTestCustomerEmail", () => {
  it("detects harness emails", () => {
    expect(isInternalTestCustomerEmail("cashfree-cert@doot.test")).toBe(true);
    expect(isInternalTestCustomerEmail("cashfree-e2e-1@doot.test")).toBe(true);
    expect(isInternalTestCustomerEmail(" Mock-Cert@Doot.Test ")).toBe(true);
  });

  it("allows real registered emails", () => {
    expect(isInternalTestCustomerEmail("neetin@gmail.com")).toBe(false);
    expect(isInternalTestCustomerEmail("user@doot.com")).toBe(false);
  });
});
