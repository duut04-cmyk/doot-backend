import type { AdapterOperation } from "../adapters/provider-adapter.types.js";

export const PROVIDER_ERROR_CATEGORIES = [
  "PROVIDER_AUTHENTICATION_ERROR",
  "PROVIDER_AUTHORIZATION_ERROR",
  "PROVIDER_VALIDATION_ERROR",
  "PROVIDER_SERVICE_UNAVAILABLE",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_TIMEOUT",
  "PROVIDER_NOT_FOUND",
  "PROVIDER_BOOKING_FAILED",
  "PROVIDER_CANCELLATION_FAILED",
  "PROVIDER_UNSUPPORTED_OPERATION",
  "PROVIDER_UNKNOWN_ERROR",
] as const;

export type ProviderErrorCategory = (typeof PROVIDER_ERROR_CATEGORIES)[number];

const RETRYABLE_CATEGORIES = new Set<ProviderErrorCategory>([
  "PROVIDER_TIMEOUT",
  "PROVIDER_SERVICE_UNAVAILABLE",
  "PROVIDER_RATE_LIMITED",
]);

export function isRetryableProviderError(category: ProviderErrorCategory): boolean {
  return RETRYABLE_CATEGORIES.has(category);
}

export class ProviderAdapterError extends Error {
  readonly providerCode: string;
  readonly operation: AdapterOperation;
  readonly category: ProviderErrorCategory;
  readonly retryable: boolean;
  readonly providerErrorCode: string | null;
  readonly safeMessage: string;
  readonly requestId: string | null;

  constructor(options: {
    providerCode: string;
    operation: AdapterOperation;
    category: ProviderErrorCategory;
    safeMessage: string;
    providerErrorCode?: string | null;
    retryable?: boolean;
    requestId?: string | null;
    cause?: unknown;
  }) {
    super(options.safeMessage, { cause: options.cause });
    this.name = "ProviderAdapterError";
    this.providerCode = options.providerCode;
    this.operation = options.operation;
    this.category = options.category;
    this.safeMessage = options.safeMessage;
    this.providerErrorCode = options.providerErrorCode ?? null;
    this.retryable = options.retryable ?? isRetryableProviderError(options.category);
    this.requestId = options.requestId ?? null;
  }
}
