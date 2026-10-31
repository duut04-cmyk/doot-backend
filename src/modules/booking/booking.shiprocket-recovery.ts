import type { ResolvedBookingOutcome } from "./booking.provider-outcome.js";
import { buildShiprocketExternalOrderId } from "../provider/adapters/shiprocket/shiprocket-order.util.js";

/**
 * When create booking times out before a Shiprocket numeric order id is known, persist the **channel**
 * order id as `providerOrderId` for reconciliation attempts and set `shiprocketChannelOrderId`.
 * This does not replace a known Shiprocket numeric order id and does not change orders/show lookup strategy.
 */
export function enrichShiprocketUnknownBookingOutcome(input: {
  providerCode: string;
  deliveryReference: string;
  resolved: ResolvedBookingOutcome;
}): ResolvedBookingOutcome {
  if (input.providerCode !== "SHIPROCKET") {
    return input.resolved;
  }
  if (input.resolved.outcome !== "UNKNOWN") {
    return input.resolved;
  }
  if (input.resolved.providerOrderId) {
    return input.resolved;
  }

  const channelOrderId = buildShiprocketExternalOrderId({
    deliveryReference: input.deliveryReference,
  });

  return {
    ...input.resolved,
    providerOrderId: channelOrderId,
    metadata: {
      ...(input.resolved.metadata ?? {}),
      shiprocketChannelOrderId: channelOrderId,
    },
  };
}
