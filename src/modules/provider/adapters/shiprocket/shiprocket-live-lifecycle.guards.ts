import type { ProviderEnvironment } from "@prisma/client";
import { resolveTrustedProviderBaseUrl } from "../provider.adapter-urls.js";

export const SHIPROCKET_LIVE_PRODUCTION_HOST = "apiv2.shiprocket.in";
export const SHIPROCKET_LIVE_PRODUCTION_ORIGIN = `https://${SHIPROCKET_LIVE_PRODUCTION_HOST}`;
export const SHIPROCKET_SANDBOX_HOST = "api-sandbox.shiprocket.in";

export const SHIPROCKET_LIVE_HOST_CONFIRM_PHRASE = "I_UNDERSTAND_LIVE_PRODUCTION";
export const SHIPROCKET_LIVE_CANCEL_CONFIRM_PHRASE = "I_UNDERSTAND_CANCEL_ONCE";

export class ShiprocketLiveLifecycleGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShiprocketLiveLifecycleGuardError";
  }
}

export function assertShiprocketLiveHostConfirmation(input: {
  confirmPhrase: string | undefined;
}): void {
  if (input.confirmPhrase?.trim() !== SHIPROCKET_LIVE_HOST_CONFIRM_PHRASE) {
    throw new ShiprocketLiveLifecycleGuardError(
      `Live run requires --confirm-live-host ${SHIPROCKET_LIVE_HOST_CONFIRM_PHRASE}`,
    );
  }
}

export function assertShiprocketLiveCancelConfirmation(input: {
  confirmPhrase: string | undefined;
}): void {
  if (input.confirmPhrase?.trim() !== SHIPROCKET_LIVE_CANCEL_CONFIRM_PHRASE) {
    throw new ShiprocketLiveLifecycleGuardError(
      `Cancellation requires --confirm-cancel ${SHIPROCKET_LIVE_CANCEL_CONFIRM_PHRASE}`,
    );
  }
}

export function assertShiprocketProductionBaseUrl(baseUrl: string): void {
  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    throw new ShiprocketLiveLifecycleGuardError("Provider base URL is invalid.");
  }
  if (hostname === SHIPROCKET_SANDBOX_HOST) {
    throw new ShiprocketLiveLifecycleGuardError(
      "Sandbox host is not permitted for live lifecycle verification.",
    );
  }
  if (hostname !== SHIPROCKET_LIVE_PRODUCTION_HOST) {
    throw new ShiprocketLiveLifecycleGuardError(
      `Live lifecycle requires trusted production host ${SHIPROCKET_LIVE_PRODUCTION_HOST}.`,
    );
  }
}

export function assertShiprocketProviderLiveEnvironment(input: {
  providerCode: string;
  environment: ProviderEnvironment;
}): string {
  if (input.providerCode !== "SHIPROCKET") {
    throw new ShiprocketLiveLifecycleGuardError("Provider must be SHIPROCKET.");
  }
  if (input.environment !== "LIVE") {
    throw new ShiprocketLiveLifecycleGuardError("Provider.environment must be LIVE.");
  }
  const baseUrl = resolveTrustedProviderBaseUrl(input.providerCode, input.environment);
  assertShiprocketProductionBaseUrl(baseUrl);
  return baseUrl;
}

export function assertShiprocketLiveFeatureFlags(input: {
  shiprocketEnabled: boolean;
  shiprocketBookingEnabled: boolean;
}): void {
  if (!input.shiprocketEnabled) {
    throw new ShiprocketLiveLifecycleGuardError(
      "SHIPROCKET_ENABLED must be true for live run.",
    );
  }
  if (!input.shiprocketBookingEnabled) {
    throw new ShiprocketLiveLifecycleGuardError(
      "SHIPROCKET_BOOKING_ENABLED must be true for live booking/cancel run.",
    );
  }
}

export function assertShiprocketPickupLocationConfigured(input: {
  pickupLocation: string | undefined;
}): void {
  if (!input.pickupLocation?.trim()) {
    throw new ShiprocketLiveLifecycleGuardError(
      "SHIPROCKET_PICKUP_LOCATION must be configured.",
    );
  }
}

export function assertUniqueDeliveryReference(reference: string | undefined): string {
  const trimmed = reference?.trim();
  if (!trimmed) {
    throw new ShiprocketLiveLifecycleGuardError(
      "A unique delivery reference is required (--delivery-reference).",
    );
  }
  return trimmed;
}
