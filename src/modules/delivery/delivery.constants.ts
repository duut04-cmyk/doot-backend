export const DELIVERY_REFERENCE_PREFIX = "DOTT";

/** Inclusive bounds for WGS84 coordinates on delivery locations. */
export const MIN_LATITUDE = -90;
export const MAX_LATITUDE = 90;
export const MIN_LONGITUDE = -180;
export const MAX_LONGITUDE = 180;

/** MVP maximum package weight (kg). Not provider-specific. */
export const MAX_WEIGHT_KG = 50;

/** Max weight (kg) for Small tier — align with deriveSizeTier. */
export const SMALL_PACKAGE_MAX_WEIGHT_KG = 0.5;
/** Max weight (kg) for Medium tier — align with deriveSizeTier. */
export const MEDIUM_PACKAGE_MAX_WEIGHT_KG = 2.5;

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

/** Supabase pooler latency can exceed Prisma's default 5s interactive transaction limit. */
export const DELIVERY_TRANSACTION_TIMEOUT_MS = 20_000;
export const DELIVERY_TRANSACTION_MAX_WAIT_MS = 10_000;
