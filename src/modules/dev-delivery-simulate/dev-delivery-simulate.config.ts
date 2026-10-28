import { env } from "../../config/env.js";

/**
 * Track-page simulation (`POST …/dev/advance`). Opt-in via ENABLE_DEV_DELIVERY_SIMULATE.
 * Allowed only when NODE_ENV is not production. When NODE_ENV=production, startup
 * validation rejects ENABLE_DEV_DELIVERY_SIMULATE=true, so the server will not start
 * with simulation enabled. Only MOCK provider bookings are advanced — see DevDeliverySimulateService.
 */
export function isDevDeliverySimulateEnabled(): boolean {
  if (process.env.ENABLE_DEV_DELIVERY_SIMULATE === "true") {
    return true;
  }
  return env.ENABLE_DEV_DELIVERY_SIMULATE;
}
