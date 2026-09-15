export const BORZO_PROVIDER_CODE = "BORZO";

export const BORZO_ADAPTER_VERSION = "1.0.0";

export const BORZO_TEST_BASE_URL =
  "https://robotapitest-in.borzodelivery.com/api/business/1.8";

export const BORZO_TEST_HOST = "robotapitest-in.borzodelivery.com";

export const BORZO_CALCULATE_ORDER_PATH = "/calculate-order";

/** Borzo default vehicle type for standard orders (Motorbike, up to 20 kg). */
export const BORZO_DEFAULT_VEHICLE_TYPE_ID = 8;

export const BORZO_AUTH_HEADER = "X-DV-Auth-Token";

export const BORZO_ORDER_TYPE_STANDARD = "standard";

/** Maps Dutt package types to Borzo matter descriptions. */
export const BORZO_MATTER_BY_PACKAGE_TYPE: Record<string, string> = {
  DOCUMENT: "Documents",
  FOOD: "Food",
  MEDICINE: "Medicine",
  OTHER: "General goods",
};
