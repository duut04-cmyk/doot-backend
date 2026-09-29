import { describe, expect, it } from "vitest";
import {
  buildSafeCashfreeClientMessage,
  extractCashfreeApiError,
} from "../src/modules/payment/gateways/cashfree/cashfree-api-errors.js";

describe("Cashfree API error helpers", () => {
  it("extracts top-level message and code", () => {
    expect(
      extractCashfreeApiError({
        message: "order_id is invalid",
        code: "order_id_invalid",
        type: "invalid_request_error",
      }),
    ).toEqual({
      message: "order_id is invalid",
      code: "order_id_invalid",
      type: "invalid_request_error",
    });
  });

  it("builds safe client message", () => {
    expect(buildSafeCashfreeClientMessage({ message: "Bad request" })).toBe(
      "Bad request",
    );
    expect(buildSafeCashfreeClientMessage({ code: "auth_failed" })).toBe(
      "Cashfree order creation failed (auth_failed).",
    );
  });
});
