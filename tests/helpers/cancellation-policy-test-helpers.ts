import type { CancellationPolicy } from "../../src/modules/provider/contracts/cancellation-policy.js";
import { toCancellationPolicySnapshot } from "../../src/modules/provider/contracts/cancellation-policy.js";

export function knownFixedFeeCancellationPolicy(
  overrides?: Partial<CancellationPolicy>,
): CancellationPolicy {
  return {
    supported: true,
    allowedBeforePickup: true,
    allowedAfterPickup: false,
    fee: { type: "FIXED", amount: 50, currency: "INR" },
    conditions: [],
    policyKnown: true,
    source: "PROVIDER",
    ...overrides,
  };
}

export function knownFreeCancellationPolicy(): CancellationPolicy {
  return {
    supported: true,
    allowedBeforePickup: true,
    allowedAfterPickup: false,
    fee: { type: "NONE" },
    conditions: [],
    policyKnown: true,
    source: "PROVIDER",
  };
}

export function unknownCancellationPolicy(): CancellationPolicy {
  return {
    supported: false,
    allowedBeforePickup: false,
    allowedAfterPickup: false,
    fee: { type: "UNKNOWN" },
    conditions: [],
    policyKnown: false,
    source: "UNKNOWN",
  };
}

export function defaultCancellationPolicySnapshot() {
  return toCancellationPolicySnapshot(knownFixedFeeCancellationPolicy());
}
