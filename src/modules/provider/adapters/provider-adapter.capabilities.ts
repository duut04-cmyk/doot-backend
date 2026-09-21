import type { ProviderCapability } from "@prisma/client";
import type { AdapterOperation } from "./provider-adapter.types.js";

export const OPERATION_REQUIRED_CAPABILITIES: Record<
  AdapterOperation,
  ProviderCapability[]
> = {
  checkServiceability: ["SERVICEABILITY"],
  getAvailability: ["AVAILABILITY"],
  getQuote: ["PRICING"],
  createBooking: ["BOOKING"],
  getBooking: ["BOOKING"],
  cancelBooking: ["CANCELLATION"],
  getCancellationPolicy: ["CANCELLATION"],
  getTracking: ["LIVE_TRACKING", "TRACKING_URL"],
  parseWebhook: ["WEBHOOKS"],
  healthCheck: [],
};

export function operationRequiresCapability(
  operation: AdapterOperation,
  configuredCapabilities: Set<ProviderCapability>,
): boolean {
  const required = OPERATION_REQUIRED_CAPABILITIES[operation];
  if (required.length === 0) {
    return true;
  }
  if (operation === "getTracking") {
    return required.some((capability) => configuredCapabilities.has(capability));
  }
  return required.every((capability) => configuredCapabilities.has(capability));
}

export function getMissingCapabilitiesForOperation(
  operation: AdapterOperation,
  configuredCapabilities: Set<ProviderCapability>,
): ProviderCapability[] {
  const required = OPERATION_REQUIRED_CAPABILITIES[operation];
  if (operation === "getTracking") {
    const hasAny = required.some((capability) =>
      configuredCapabilities.has(capability),
    );
    return hasAny ? [] : required;
  }
  return required.filter((capability) => !configuredCapabilities.has(capability));
}
