import type { ProviderEnvironment } from "@prisma/client";
import {
  buildShiprocketAdhocOrderPayload,
  isStrictLiveShiprocketBooking,
} from "./shiprocket-booking-payload.js";
import type { BookingRequest } from "../../contracts/booking.js";
import {
  assertShiprocketLiveCancelConfirmation,
  assertShiprocketLiveFeatureFlags,
  assertShiprocketLiveHostConfirmation,
  assertShiprocketPickupLocationConfigured,
  assertShiprocketProviderLiveEnvironment,
  assertUniqueDeliveryReference,
} from "./shiprocket-live-lifecycle.guards.js";
import {
  createShiprocketLiveLifecycleArtifactRecorder,
  setShiprocketLiveLifecycleArtifactRecorder,
} from "./shiprocket-live-lifecycle-artifacts.js";
import { requireShiprocketCourierId } from "./shiprocket-metadata.util.js";

export type ShiprocketLiveLifecyclePreflightInput = {
  dryRun: boolean;
  confirmLiveHost?: string;
  deliveryReference?: string;
  shiprocketEnabled: boolean;
  shiprocketBookingEnabled: boolean;
  pickupLocation: string | undefined;
  provider: {
    code: string;
    environment: ProviderEnvironment;
  };
  bookingRequest?: BookingRequest;
};

export type ShiprocketLiveLifecyclePreflightResult = {
  ok: true;
  dryRun: boolean;
  productionBaseUrl: string;
  checks: string[];
};

export function runShiprocketLiveLifecyclePreflight(
  input: ShiprocketLiveLifecyclePreflightInput,
): ShiprocketLiveLifecyclePreflightResult {
  const checks: string[] = [];

  if (!input.dryRun) {
    assertShiprocketLiveHostConfirmation({ confirmPhrase: input.confirmLiveHost });
    checks.push("live_host_confirmation");
  }

  assertShiprocketLiveFeatureFlags({
    shiprocketEnabled: input.shiprocketEnabled,
    shiprocketBookingEnabled: input.shiprocketBookingEnabled,
  });
  checks.push("feature_flags");

  assertShiprocketPickupLocationConfigured({
    pickupLocation: input.pickupLocation,
  });
  checks.push("pickup_location");

  const productionBaseUrl = assertShiprocketProviderLiveEnvironment({
    providerCode: input.provider.code,
    environment: input.provider.environment,
  });
  checks.push("production_host");

  assertUniqueDeliveryReference(input.deliveryReference);
  checks.push("delivery_reference");

  if (input.bookingRequest) {
    requireShiprocketCourierId({
      providerMetadata: input.bookingRequest.providerMetadata,
      providerQuoteId: input.bookingRequest.providerQuoteId,
    });
    checks.push("courier_id");

    buildShiprocketAdhocOrderPayload({
      request: input.bookingRequest,
      strictLive: isStrictLiveShiprocketBooking(input.provider.environment),
    });
    checks.push("live_booking_payload");
  }

  return {
    ok: true,
    dryRun: input.dryRun,
    productionBaseUrl,
    checks,
  };
}

export async function prepareShiprocketLiveLifecycleArtifactRun(input: {
  runId: string;
  reportsRoot?: string;
}): Promise<void> {
  const recorder = await createShiprocketLiveLifecycleArtifactRecorder({
    runId: input.runId,
    reportsRoot: input.reportsRoot,
  });
  setShiprocketLiveLifecycleArtifactRecorder(recorder);
}

export function clearShiprocketLiveLifecycleArtifactRun(): void {
  setShiprocketLiveLifecycleArtifactRecorder(null);
}

export function assertLiveCancellationGate(input: { confirmCancel?: string }): void {
  assertShiprocketLiveCancelConfirmation({ confirmPhrase: input.confirmCancel });
}
