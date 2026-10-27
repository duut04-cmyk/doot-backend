import type { ResolvedBookingOutcome } from "./booking.provider-outcome.js";
import { buildShiprocketExternalOrderId } from "../provider/adapters/shiprocket/shiprocket-order.util.js";

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
