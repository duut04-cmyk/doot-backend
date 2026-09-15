export const DELIVERY_REFERENCE_PREFIX = "DUTT";

/** MVP maximum package weight (kg). Not provider-specific. */
export const MAX_WEIGHT_KG = 50;

/** Dimensions required when weight exceeds this threshold (kg). */
export const DIMENSIONS_REQUIRED_ABOVE_KG = 3;

export const MAX_ADDRESS_LENGTH = 500;
export const MAX_CONTACT_NAME_LENGTH = 100;
export const MAX_INSTRUCTIONS_LENGTH = 500;
export const MAX_SPECIAL_INSTRUCTIONS_LENGTH = 500;
export const MAX_PACKAGE_DESCRIPTION_LENGTH = 200;
export const MAX_OBJECT_KEY_LENGTH = 512;
export const MAX_PACKAGE_PHOTOS = 10;
export const DEFAULT_PACKAGE_QUANTITY = 1;

export const DEFAULT_LIST_PAGE = 1;
export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 100;

/**
 * Durable object storage key (not a browser blob URL or absolute http(s) URL).
 * Example: deliveries/uuid/photos/front.jpg
 */
export const OBJECT_KEY_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/;

export const IDEMPOTENCY_HEADER = "idempotency-key";
export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
