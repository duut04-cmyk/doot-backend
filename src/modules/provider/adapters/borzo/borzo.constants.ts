export const BORZO_PROVIDER_CODE = "BORZO";

export const BORZO_ADAPTER_VERSION = "2.0.0";

export const BORZO_TEST_BASE_URL =
  "https://robotapitest-in.borzodelivery.com/api/business/1.8";

export const BORZO_TEST_HOST = "robotapitest-in.borzodelivery.com";

export const BORZO_CALCULATE_ORDER_PATH = "/calculate-order";
export const BORZO_CREATE_ORDER_PATH = "/create-order";
export const BORZO_CANCEL_ORDER_PATH = "/cancel-order";
export const BORZO_COURIER_PATH = "/courier";
export const BORZO_ORDERS_PATH = "/orders";

/** Max length for Borzo client_order_id per official API. */
export const BORZO_CLIENT_ORDER_ID_MAX_LENGTH = 32;

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
