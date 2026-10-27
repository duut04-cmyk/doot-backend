import { env } from "../../config/env.js";

/**
 * Track-page simulation (`POST …/dev/advance`). Opt-in via ENABLE_DEV_DELIVERY_SIMULATE.
 * Works in development and production (e.g. Render staging) when explicitly enabled.
 * Only MOCK provider bookings are advanced — see DevDeliverySimulateService.
 */
export function isDevDeliverySimulateEnabled(): boolean {
  if (process.env.ENABLE_DEV_DELIVERY_SIMULATE === "true") {
    return true;
  }
  return env.ENABLE_DEV_DELIVERY_SIMULATE;
}
