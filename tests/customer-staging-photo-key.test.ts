import { describe, expect, it } from "vitest";
import { isCustomerStagingPhotoKey } from "../src/modules/delivery/delivery.constants.js";

describe("isCustomerStagingPhotoKey", () => {
  const customerId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const batchId = "11111111-2222-4333-8444-555555555555";

  it("accepts keys under staging/{customerId}/{batch}/photos/", () => {
    const key = `staging/${customerId}/${batchId}/photos/abc.jpg`;
    expect(isCustomerStagingPhotoKey(customerId, key)).toBe(true);
  });

  it("rejects other customers' staging prefixes", () => {
    const key = `staging/other-user/${batchId}/photos/abc.jpg`;
    expect(isCustomerStagingPhotoKey(customerId, key)).toBe(false);
  });
});
