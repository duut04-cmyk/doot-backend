import { describe, expect, it } from "vitest";
import { hasMaterialCancellationPolicyChange } from "../src/modules/booking/booking.policy-freshness.js";
import {
  knownFixedFeeCancellationPolicy,
  knownFreeCancellationPolicy,
} from "./helpers/cancellation-policy-test-helpers.js";
import { toCancellationPolicySnapshot } from "../src/modules/provider/contracts/cancellation-policy.js";

describe("hasMaterialCancellationPolicyChange", () => {
  it("returns false when policy is unchanged", () => {
    const original = toCancellationPolicySnapshot(knownFixedFeeCancellationPolicy());
    expect(
      hasMaterialCancellationPolicyChange({
        original,
        refreshed: knownFixedFeeCancellationPolicy(),
      }),
    ).toBe(false);
  });

  it("returns true when policyKnown flips", () => {
    const original = toCancellationPolicySnapshot(knownFixedFeeCancellationPolicy());
    expect(
      hasMaterialCancellationPolicyChange({
        original,
        refreshed: {
          ...knownFixedFeeCancellationPolicy(),
          policyKnown: false,
          source: "UNKNOWN",
        },
      }),
    ).toBe(true);
  });

  it("returns true when allowedBeforePickup changes", () => {
    const original = toCancellationPolicySnapshot(knownFixedFeeCancellationPolicy());
    expect(
      hasMaterialCancellationPolicyChange({
        original,
        refreshed: {
          ...knownFixedFeeCancellationPolicy(),
          allowedBeforePickup: false,
        },
      }),
    ).toBe(true);
  });

  it("returns true when fixed fee amount changes", () => {
    const original = toCancellationPolicySnapshot(knownFixedFeeCancellationPolicy());
    expect(
      hasMaterialCancellationPolicyChange({
        original,
        refreshed: {
          ...knownFixedFeeCancellationPolicy(),
          fee: { type: "FIXED", amount: 75, currency: "INR" },
        },
      }),
    ).toBe(true);
  });

  it("returns true when fee type changes", () => {
    const original = toCancellationPolicySnapshot(knownFixedFeeCancellationPolicy());
    expect(
      hasMaterialCancellationPolicyChange({
        original,
        refreshed: knownFreeCancellationPolicy(),
      }),
    ).toBe(true);
  });
});
