import type { CancellationPolicy } from "../../contracts/cancellation-policy.js";

export const SHIPROCKET_PROVIDER_CODE = "SHIPROCKET";

export const SHIPROCKET_ADAPTER_VERSION = "1.0.0-phase1";

export const SHIPROCKET_AUTH_PATH = "/v1/external/auth/login";

export const SHIPROCKET_HYPERLOCAL_SERVICEABILITY_PATH =
  "/v1/external/courier/serviceability";

/** Headers for Shiprocket JSON read APIs (serviceability GET). */
export const SHIPROCKET_JSON_READ_HEADERS = {
  accept: "application/json",
} as const;

export const SHIPROCKET_CREATE_ADHOC_ORDER_PATH = "/v1/external/orders/create/adhoc";

export const SHIPROCKET_ASSIGN_AWB_PATH = "/v1/external/courier/assign/awb";

export const SHIPROCKET_CANCEL_ORDERS_PATH = "/v1/external/orders/cancel";

export const SHIPROCKET_ORDER_SHOW_PATH_PREFIX = "/v1/external/orders/show/";

export const SHIPROCKET_TRACK_AWB_PATH_PREFIX = "/v1/external/courier/track/awb/";

export const SHIPROCKET_TRACK_SHIPMENT_PATH_PREFIX =
  "/v1/external/courier/track/shipment/";

/** Documented JWT lifetime (~10 days) when no reliable expiry is available. */
export const SHIPROCKET_TOKEN_FALLBACK_TTL_MS = 10 * 24 * 60 * 60 * 1000;

/** @deprecated Use SHIPROCKET_TOKEN_FALLBACK_TTL_MS — kept for existing imports. */
export const SHIPROCKET_TOKEN_TTL_MS = SHIPROCKET_TOKEN_FALLBACK_TTL_MS;

/** Refresh when remaining validity is at or below this threshold (~day 9 for 10-day tokens). */
export const SHIPROCKET_TOKEN_REFRESH_IF_REMAINING_MS = 24 * 60 * 60 * 1000;

/** @deprecated Use SHIPROCKET_TOKEN_REFRESH_IF_REMAINING_MS — kept for existing imports. */
export const SHIPROCKET_TOKEN_REFRESH_BUFFER_MS =
  SHIPROCKET_TOKEN_REFRESH_IF_REMAINING_MS;

/**
 * Active refresh lease duration — covers bounded login + persist.
 * Reclaim only when `refreshLeaseUntil` has passed (not via row `updatedAt`).
 */
export const SHIPROCKET_AUTH_REFRESH_LEASE_MS = 120 * 1000;

/** @deprecated Reclaim uses expired `refreshLeaseUntil` only. */
export const SHIPROCKET_AUTH_REFRESH_LEASE_STALE_MS = 120 * 1000;

/** Prisma transaction timeout for first-login advisory xact lock (includes HTTP login). */
export const SHIPROCKET_AUTH_FIRST_LOGIN_TRANSACTION_MS = 150 * 1000;

export const SHIPROCKET_AUTH_REFRESH_LEASE_PREFIX = "refresh-lease:";

/**
 * Phase 1 cancellation defaults for Shiprocket hyperlocal (product/legal review).
 * Prepaid-only flow: cancellation allowed before pickup with a fixed fee.
 */
export function shiprocketPhase1CancellationPolicy(): CancellationPolicy {
  return {
    supported: true,
    allowedBeforePickup: true,
    allowedAfterPickup: false,
    fee: { type: "FIXED", amount: 49, currency: "INR" },
    conditions: ["Prepaid bookings only", "Cancellation before pickup only"],
    policyKnown: true,
    source: "DUTT_CONFIG",
  };
}
