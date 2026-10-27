import { ProviderAdapterError } from "../../contracts/provider-error.js";
import type { AdapterOperation } from "../provider-adapter.types.js";
import { SHIPROCKET_PROVIDER_CODE } from "./shiprocket.constants.js";
import {
  parseShiprocketOrderShowBody,
  type ShiprocketCreatedOrderSnapshot,
} from "./shiprocket-order.util.js";

/**
 * Interprets Shiprocket orders/show for booking recovery.
 * Only HTTP 404 means "no existing order — safe to create adhoc".
 * Any other failure or ambiguous body must not be treated as not-found.
 */
export function resolveOrderShowProbeResult(input: {
  status: number;
  data: unknown;
  operation: AdapterOperation;
  requestId: string;
}): ShiprocketCreatedOrderSnapshot | null {
  if (input.status === 404) {
    return null;
  }

  if (input.status === 498) {
    throw new ProviderAdapterError({
      providerCode: SHIPROCKET_PROVIDER_CODE,
      operation: input.operation,
      category: "PROVIDER_SERVICE_UNAVAILABLE",
      safeMessage: "Shiprocket access was denied by edge infrastructure.",
      retryable: false,
      requestId: input.requestId,
    });
  }

  if (input.status === 401) {
    throw new ProviderAdapterError({
      providerCode: SHIPROCKET_PROVIDER_CODE,
      operation: input.operation,
      category: "PROVIDER_AUTHENTICATION_ERROR",
      safeMessage: "Shiprocket order lookup authentication failed.",
      retryable: false,
      requestId: input.requestId,
    });
  }

  if (input.status === 403) {
    throw new ProviderAdapterError({
      providerCode: SHIPROCKET_PROVIDER_CODE,
      operation: input.operation,
      category: "PROVIDER_AUTHORIZATION_ERROR",
      safeMessage: "Shiprocket order lookup was forbidden.",
      retryable: false,
      requestId: input.requestId,
    });
  }

  if (input.status >= 500) {
    throw new ProviderAdapterError({
      providerCode: SHIPROCKET_PROVIDER_CODE,
      operation: input.operation,
      category: "PROVIDER_SERVICE_UNAVAILABLE",
      safeMessage: "Shiprocket order lookup is temporarily unavailable.",
      retryable: false,
      requestId: input.requestId,
    });
  }

  if (input.status < 200 || input.status >= 300) {
    throw new ProviderAdapterError({
      providerCode: SHIPROCKET_PROVIDER_CODE,
      operation: input.operation,
      category: "PROVIDER_UNKNOWN_ERROR",
      safeMessage: "Shiprocket order lookup returned an ambiguous outcome.",
      retryable: false,
      requestId: input.requestId,
    });
  }

  const snapshot = parseShiprocketOrderShowBody(input.data);
  if (!snapshot) {
    throw new ProviderAdapterError({
      providerCode: SHIPROCKET_PROVIDER_CODE,
      operation: input.operation,
      category: "PROVIDER_UNKNOWN_ERROR",
      safeMessage:
        "Shiprocket order lookup succeeded but the response could not be interpreted.",
      retryable: false,
      requestId: input.requestId,
    });
  }

  return snapshot;
}
