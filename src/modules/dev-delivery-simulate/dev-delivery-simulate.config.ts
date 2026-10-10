import { env } from "../../config/env.js";

export function isDevDeliverySimulateEnabled(): boolean {
  if (env.NODE_ENV === "production") {
    return false;
  }
  if (process.env.ENABLE_DEV_DELIVERY_SIMULATE === "true") {
    return true;
  }
  return env.ENABLE_DEV_DELIVERY_SIMULATE;
}
