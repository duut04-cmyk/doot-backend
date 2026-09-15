import type { DeliveryStatus } from "@prisma/client";
import type { ProviderBookingStatus } from "@prisma/client";
import type { ProviderWithRelations } from "../provider/provider.repository.js";
import { providerAdapterRegistry } from "../provider/adapters/provider-adapter-registry.js";
import {
  operationRequiresCapability,
} from "../provider/adapters/provider-adapter.capabilities.js";
import { CANCELLABLE_DELIVERY_STATUSES } from "../delivery/delivery.transitions.js";

export function isDeliveryCancellable(status: DeliveryStatus): boolean {
  return CANCELLABLE_DELIVERY_STATUSES.includes(status);
}

export function isProviderCancellationEligible(
  provider: ProviderWithRelations,
): boolean {
  if (!provider.enabled || provider.status !== "ACTIVE") {
    return false;
  }
  const caps = new Set(provider.capabilities.map((c) => c.capability));
  if (!operationRequiresCapability("cancelBooking", caps)) {
    return false;
  }
  const adapter = providerAdapterRegistry.resolve(provider.code);
  return adapter?.supportsOperation("cancelBooking") ?? false;
}

export function canCancelWithBooking(input: {
  deliveryStatus: DeliveryStatus;
  bookingStatus: ProviderBookingStatus | null;
}): { allowed: boolean; localOnly: boolean } {
  if (!isDeliveryCancellable(input.deliveryStatus)) {
    return { allowed: false, localOnly: false };
  }

  const preBooking: DeliveryStatus[] = [
    "CREATED",
    "ORCHESTRATING",
    "OPTION_READY",
  ];
  if (preBooking.includes(input.deliveryStatus)) {
    return { allowed: true, localOnly: true };
  }

  if (input.bookingStatus === "UNKNOWN") {
    return { allowed: false, localOnly: false };
  }

  if (input.bookingStatus === "BOOKED") {
    return { allowed: true, localOnly: false };
  }

  return { allowed: false, localOnly: false };
}
