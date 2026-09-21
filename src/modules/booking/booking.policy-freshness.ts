import type {
  CancellationPolicy,
  CancellationPolicySnapshot,
} from "../provider/contracts/cancellation-policy.js";

export function hasMaterialCancellationPolicyChange(input: {
  original: CancellationPolicySnapshot;
  refreshed: CancellationPolicy;
}): boolean {
  const { original, refreshed } = input;

  if (original.policyKnown !== refreshed.policyKnown) {
    return true;
  }

  if (!original.policyKnown && !refreshed.policyKnown) {
    return false;
  }

  if (original.allowedBeforePickup !== refreshed.allowedBeforePickup) {
    return true;
  }

  if (original.allowedAfterPickup !== refreshed.allowedAfterPickup) {
    return true;
  }

  if (original.fee.type !== refreshed.fee.type) {
    return true;
  }

  if (
    original.fee.type === "FIXED" &&
    refreshed.fee.type === "FIXED" &&
    original.fee.amount != null &&
    refreshed.fee.amount != null &&
    original.fee.amount !== refreshed.fee.amount
  ) {
    return true;
  }

  if (
    original.fee.type === "PERCENTAGE" &&
    refreshed.fee.type === "PERCENTAGE" &&
    original.fee.amount != null &&
    refreshed.fee.amount != null &&
    original.fee.amount !== refreshed.fee.amount
  ) {
    return true;
  }

  if (
    original.fee.currency != null &&
    refreshed.fee.currency != null &&
    original.fee.currency !== refreshed.fee.currency
  ) {
    return true;
  }

  return false;
}
