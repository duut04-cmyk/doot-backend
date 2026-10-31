import { ProviderAdapterError } from "../../contracts/provider-error.js";
import type { AdapterOperation } from "../provider-adapter.types.js";
import type { ProviderRuntimeConfig } from "../provider-config.types.js";
import {
  ProviderHttpClient,
  type ProviderHttpRequest,
  type ProviderHttpResponse,
} from "../provider-http-client.js";
import { SHIPROCKET_PROVIDER_CODE } from "./shiprocket.constants.js";
import type { ShiprocketAuthService } from "./shiprocket-auth.service.js";

export async function shiprocketAuthenticatedReadRequest<T = unknown>(input: {
  http: ProviderHttpClient;
  auth: ShiprocketAuthService;
  config: ProviderRuntimeConfig;
  requestId: string;
  operation: AdapterOperation;
  resourceLabel: string;
  request: Omit<ProviderHttpRequest, "headers"> & {
    headers?: Record<string, string>;
  };
  allowErrorResponseBody?: boolean;
}): Promise<ProviderHttpResponse<T>> {
  const bearerToken = await input.auth.getBearerToken({
    config: input.config,
    requestId: input.requestId,
  });

  const call = (token: string) =>
    input.http.request<T>({
      config: input.config,
      operation: input.operation,
      requestId: input.requestId,
      request: {
        ...input.request,
        headers: {
          ...input.request.headers,
          authorization: `Bearer ${token}`,
        },
      },
      allowErrorResponseBody: input.allowErrorResponseBody ?? true,
    });

  let response = await call(bearerToken);
  if (response.status !== 401) {
    return response;
  }

  input.auth.invalidateMemoryCache(input.config.providerId);
  const refreshedToken = await input.auth.getBearerToken({
    config: input.config,
    requestId: input.requestId,
    forceRefresh: true,
  });
  response = await call(refreshedToken);

  if (response.status === 401) {
    throw new ProviderAdapterError({
      providerCode: SHIPROCKET_PROVIDER_CODE,
      operation: input.operation,
      category: "PROVIDER_AUTHENTICATION_ERROR",
      safeMessage: `Shiprocket ${input.resourceLabel} authentication failed.`,
      retryable: false,
      requestId: input.requestId,
    });
  }

  return response;
}

/** Mutations must not auto-retry on 401 — caller handles errors explicitly. */
export async function shiprocketAuthenticatedMutationRequest<T = unknown>(input: {
  http: ProviderHttpClient;
  auth: ShiprocketAuthService;
  config: ProviderRuntimeConfig;
  requestId: string;
  operation: AdapterOperation;
  request: Omit<ProviderHttpRequest, "headers"> & {
    headers?: Record<string, string>;
  };
  allowErrorResponseBody?: boolean;
}): Promise<ProviderHttpResponse<T>> {
  const bearerToken = await input.auth.getBearerToken({
    config: input.config,
    requestId: input.requestId,
  });

  return input.http.request<T>({
    config: input.config,
    operation: input.operation,
    requestId: input.requestId,
    request: {
      ...input.request,
      headers: {
        ...input.request.headers,
        authorization: `Bearer ${bearerToken}`,
      },
    },
    allowErrorResponseBody: input.allowErrorResponseBody ?? true,
  });
}
