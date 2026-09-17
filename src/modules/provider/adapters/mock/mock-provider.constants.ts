import type { ProviderCapability } from "@prisma/client";

export const MOCK_PROVIDER_CODE = "MOCK";

/** Database capabilities that must match MockProviderAdapter.metadata.supportedCapabilities */
export const MOCK_CAPABILITIES: ProviderCapability[] = [
  "SERVICEABILITY",
  "AVAILABILITY",
  "PRICING",
  "BOOKING",
  "CANCELLATION",
  "LIVE_TRACKING",
  "TRACKING_URL",
  "WEBHOOKS",
];
export const MOCK_ADAPTER_VERSION = "1.0.0";
export const MOCK_BOOKING_ID = "MOCK-BOOKING-1001";
export const MOCK_QUOTE_ID = "MOCK-QUOTE-9001";
export const MOCK_CANCELLATION_ID = "MOCK-CANCEL-7001";
