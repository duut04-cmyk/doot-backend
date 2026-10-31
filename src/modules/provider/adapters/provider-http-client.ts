import { logger } from "../../../config/logger.js";
import { ProviderAdapterError } from "../contracts/provider-error.js";
import type { AdapterOperation } from "./provider-adapter.types.js";
import type { ProviderRuntimeConfig } from "./provider-config.types.js";
import type { ShiprocketLiveLifecycleHttpExchangeOutcome } from "./shiprocket/shiprocket-live-lifecycle-artifacts.js";

const REDACTED_HEADER_NAMES = new Set([
  "authorization",
  "x-api-key",
  "api-key",
  "x-auth-token",
  "x-dv-auth-token",
]);

type FetchFn = typeof fetch;

export function resolveProviderRequestUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  if (!path || path === "/") {
    return normalizedBase.replace(/\/$/, "");
  }
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return new URL(normalizedPath, normalizedBase).toString();
}

export type ProviderHttpRequest = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
};

export type ProviderHttpResponse<T = unknown> = {
  status: number;
  data: T;
  headers: Record<string, string>;
  durationMs: number;
};

export class ProviderHttpClient {
  constructor(private readonly fetchImpl: FetchFn = fetch) {}

  async request<T = unknown>(input: {
    config: ProviderRuntimeConfig;
    operation: AdapterOperation;
    requestId: string;
    request: ProviderHttpRequest;
    allowErrorResponseBody?: boolean;
  }): Promise<ProviderHttpResponse<T>> {
    const started = Date.now();
    const url = resolveProviderRequestUrl(input.config.baseUrl, input.request.path);
    const timeoutMs = input.request.timeoutMs ?? input.config.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-request-id": input.requestId,
      ...input.request.headers,
    };

    let exchangeRecorded = false;

    const recordAttempt = async (payload: {
      outcome: ShiprocketLiveLifecycleHttpExchangeOutcome;
      status: number | null;
      responseBody: unknown;
      durationMs: number;
      errorCategory?: string | null;
      safeErrorMessage?: string | null;
    }): Promise<void> => {
      if (exchangeRecorded) {
        return;
      }
      exchangeRecorded = true;
      await recordShiprocketLiveLifecycleExchange({
        config: input.config,
        request: input.request,
        headers,
        status: payload.status,
        requestBody: input.request.body,
        responseBody: payload.responseBody,
        durationMs: payload.durationMs,
        outcome: payload.outcome,
        errorCategory: payload.errorCategory,
        safeErrorMessage: payload.safeErrorMessage,
      });
    };

    try {
      const response = await this.fetchImpl(url, {
        method: input.request.method,
        headers,
        body:
          input.request.body === undefined
            ? undefined
            : JSON.stringify(input.request.body),
        signal: controller.signal,
      });

      const durationMs = Date.now() - started;
      const text = await response.text();
      let data: T;
      try {
        data = text ? (JSON.parse(text) as T) : ({} as T);
      } catch {
        data = text as T;
      }

      logger.info(
        {
          requestId: input.requestId,
          providerCode: input.config.providerCode,
          operation: input.operation,
          status: response.status,
          durationMs,
          urlPath: input.request.path,
        },
        "provider_http_response",
      );

      if (response.ok && text.length > 0 && typeof data === "string") {
        const parseMessage = "Response body was not valid JSON.";
        await recordAttempt({
          outcome: "parse_error",
          status: response.status,
          responseBody: data,
          durationMs,
          errorCategory: "PROVIDER_UNKNOWN_ERROR",
          safeErrorMessage: parseMessage,
        });
        throw new ProviderAdapterError({
          providerCode: input.config.providerCode,
          operation: input.operation,
          category: "PROVIDER_UNKNOWN_ERROR",
          safeMessage: parseMessage,
          retryable: false,
          requestId: input.requestId,
        });
      }

      if (!response.ok) {
        const errorBodyResponse = {
          status: response.status,
          data,
          headers: Object.fromEntries(response.headers.entries()),
          durationMs,
        };

        if (
          input.allowErrorResponseBody &&
          response.status >= 400 &&
          response.status < 500
        ) {
          await recordAttempt({
            outcome: "http_error",
            status: response.status,
            responseBody: data,
            durationMs,
            errorCategory: "PROVIDER_VALIDATION_ERROR",
            safeErrorMessage: `Provider HTTP request failed with status ${response.status}.`,
          });
          return errorBodyResponse;
        }

        const edgeAccessDenied = response.status === 498;
        const category = edgeAccessDenied
          ? "PROVIDER_SERVICE_UNAVAILABLE"
          : response.status === 429
            ? "PROVIDER_RATE_LIMITED"
            : response.status >= 500
              ? "PROVIDER_SERVICE_UNAVAILABLE"
              : response.status === 401
                ? "PROVIDER_AUTHENTICATION_ERROR"
                : response.status === 403
                  ? "PROVIDER_AUTHORIZATION_ERROR"
                  : response.status === 404
                    ? "PROVIDER_NOT_FOUND"
                    : "PROVIDER_VALIDATION_ERROR";

        await recordAttempt({
          outcome: "http_error",
          status: response.status,
          responseBody: data,
          durationMs,
          errorCategory: category,
          safeErrorMessage: edgeAccessDenied
            ? "Provider access was denied by edge infrastructure."
            : `Provider HTTP request failed with status ${response.status}.`,
        });

        throw new ProviderAdapterError({
          providerCode: input.config.providerCode,
          operation: input.operation,
          category,
          safeMessage: edgeAccessDenied
            ? "Provider access was denied by edge infrastructure."
            : `Provider HTTP request failed with status ${response.status}.`,
          providerErrorCode: String(response.status),
          retryable: edgeAccessDenied ? false : undefined,
          requestId: input.requestId,
        });
      }

      const successResponse = {
        status: response.status,
        data,
        headers: Object.fromEntries(response.headers.entries()),
        durationMs,
      };
      await recordAttempt({
        outcome: "success",
        status: response.status,
        responseBody: data,
        durationMs,
      });
      return successResponse;
    } catch (error) {
      const durationMs = Date.now() - started;
      if (error instanceof ProviderAdapterError) {
        if (!exchangeRecorded) {
          await recordAttempt({
            outcome:
              error.category === "PROVIDER_TIMEOUT"
                ? "timeout"
                : error.category === "PROVIDER_UNKNOWN_ERROR"
                  ? "network_error"
                  : "http_error",
            status: null,
            responseBody: null,
            durationMs,
            errorCategory: error.category,
            safeErrorMessage: error.safeMessage,
          });
        }
        throw error;
      }
      const isAbort = error instanceof Error && error.name === "AbortError";
      logger.warn(
        {
          requestId: input.requestId,
          providerCode: input.config.providerCode,
          operation: input.operation,
          durationMs,
          urlPath: input.request.path,
          errorCategory: isAbort ? "PROVIDER_TIMEOUT" : "PROVIDER_UNKNOWN_ERROR",
        },
        "provider_http_failed",
      );

      if (!exchangeRecorded) {
        await recordAttempt({
          outcome: isAbort ? "timeout" : "network_error",
          status: null,
          responseBody: null,
          durationMs,
          errorCategory: isAbort ? "PROVIDER_TIMEOUT" : "PROVIDER_UNKNOWN_ERROR",
          safeErrorMessage: isAbort
            ? "Provider request timed out."
            : "Provider request failed.",
        });
      }

      throw new ProviderAdapterError({
        providerCode: input.config.providerCode,
        operation: input.operation,
        category: isAbort ? "PROVIDER_TIMEOUT" : "PROVIDER_UNKNOWN_ERROR",
        safeMessage: isAbort
          ? "Provider request timed out."
          : "Provider request failed.",
        requestId: input.requestId,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

async function recordShiprocketLiveLifecycleExchange(input: {
  config: ProviderRuntimeConfig;
  request: ProviderHttpRequest;
  headers: Record<string, string>;
  status: number | null;
  requestBody: unknown;
  responseBody: unknown;
  durationMs: number;
  outcome: ShiprocketLiveLifecycleHttpExchangeOutcome;
  errorCategory?: string | null;
  safeErrorMessage?: string | null;
}): Promise<void> {
  if (input.config.providerCode !== "SHIPROCKET") {
    return;
  }
  const mod = await import("./shiprocket/shiprocket-live-lifecycle-artifacts.js");
  await mod.maybeRecordShiprocketHttpExchange({
    config: input.config,
    request: input.request,
    requestId: "lifecycle-artifact",
    sanitizedHeaders: redactProviderHeaders(input.headers),
    status: input.status,
    requestBody: input.requestBody,
    responseBody: input.responseBody,
    durationMs: input.durationMs,
    outcome: input.outcome,
    errorCategory: input.errorCategory,
    safeErrorMessage: input.safeErrorMessage,
  });
}

export function redactProviderHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    redacted[key] = REDACTED_HEADER_NAMES.has(key.toLowerCase()) ? "[REDACTED]" : value;
  }
  return redacted;
}

export const providerHttpClient = new ProviderHttpClient();
