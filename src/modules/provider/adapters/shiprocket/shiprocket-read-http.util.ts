import { ProviderAdapterError } from "../../contracts/provider-error.js";
import type { AdapterOperation } from "../provider-adapter.types.js";
import { SHIPROCKET_PROVIDER_CODE } from "./shiprocket.constants.js";

export function assertShiprocketHttpErrorResponse(input: {
  status: number;
  operation: AdapterOperation;
  requestId: string;
  resourceLabel: string;
}): void {
  const { status, operation, requestId, resourceLabel } = input;

  if (status === 404) {
    throw new ProviderAdapterError({
      providerCode: SHIPROCKET_PROVIDER_CODE,
      operation,
      category: "PROVIDER_NOT_FOUND",
      safeMessage: `Shiprocket ${resourceLabel} not found.`,
      retryable: false,
      requestId,
    });
  }

  if (status === 498) {
    throw new ProviderAdapterError({
      providerCode: SHIPROCKET_PROVIDER_CODE,
      operation,
      category: "PROVIDER_SERVICE_UNAVAILABLE",
      safeMessage: "Shiprocket access was denied by edge infrastructure.",
      retryable: false,
      requestId,
    });
  }

  if (status === 401) {
    throw new ProviderAdapterError({
      providerCode: SHIPROCKET_PROVIDER_CODE,
      operation,
      category: "PROVIDER_AUTHENTICATION_ERROR",
      safeMessage: `Shiprocket ${resourceLabel} authentication failed.`,
      retryable: false,
      requestId,
    });
  }

  if (status === 403) {
    throw new ProviderAdapterError({
      providerCode: SHIPROCKET_PROVIDER_CODE,
      operation,
      category: "PROVIDER_AUTHORIZATION_ERROR",
      safeMessage: `Shiprocket ${resourceLabel} was forbidden.`,
      retryable: false,
      requestId,
    });
  }

  if (status === 429) {
    throw new ProviderAdapterError({
      providerCode: SHIPROCKET_PROVIDER_CODE,
      operation,
      category: "PROVIDER_RATE_LIMITED",
      safeMessage: `Shiprocket ${resourceLabel} is rate limited.`,
      retryable: true,
      requestId,
    });
  }

  if (status >= 500) {
    throw new ProviderAdapterError({
      providerCode: SHIPROCKET_PROVIDER_CODE,
      operation,
      category: "PROVIDER_SERVICE_UNAVAILABLE",
      safeMessage: `Shiprocket ${resourceLabel} is temporarily unavailable.`,
      retryable: false,
      requestId,
    });
  }

  if (status < 200 || status >= 300) {
    throw new ProviderAdapterError({
      providerCode: SHIPROCKET_PROVIDER_CODE,
      operation,
      category: "PROVIDER_UNKNOWN_ERROR",
      safeMessage: `Shiprocket ${resourceLabel} lookup returned an ambiguous outcome.`,
      retryable: false,
      requestId,
    });
  }
}

export function assertShiprocketReadHttpSuccess(input: {
  status: number;
  operation: AdapterOperation;
  requestId: string;
  resourceLabel: string;
}): void {
  if (input.status >= 200 && input.status < 300) {
    return;
  }
  assertShiprocketHttpErrorResponse(input);
}
