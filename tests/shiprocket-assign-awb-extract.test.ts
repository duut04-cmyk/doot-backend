import { describe, expect, it } from "vitest";
import { extractShiprocketAssignAwb } from "../src/modules/provider/adapters/shiprocket/shiprocket.types.js";

describe("extractShiprocketAssignAwb", () => {
  it("returns top-level awb_code when present", () => {
    expect(
      extractShiprocketAssignAwb({
        success: true,
        message: "ok",
        awb_code: "SR123456789IN",
      }),
    ).toBe("SR123456789IN");
  });

  it("returns null for processing acknowledgement without AWB fields", () => {
    expect(
      extractShiprocketAssignAwb({
        success: true,
        message: "We are processing your request",
      }),
    ).toBeNull();
  });
});
