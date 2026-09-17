import { logger } from "../../../config/logger.js";
import { ProviderAdapterError } from "../contracts/provider-error.js";
import type { AdapterOperation } from "./provider-adapter.types.js";
import type { ProviderRuntimeConfig } from "./provider-config.types.js";

const REDACTED_HEADER_NAMES = new Set([
  "authorization",
  "x-api-key",
  "api-key",
  "x-auth-token",
  "x-dv-auth-token",
]);

type FetchFn = typeof fetch;

export function resolveProviderRequestUrl(
  baseUrl: string,
  path: string,
): string {
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
    const url = resolveProviderRequestUrl(
      input.config.baseUrl,
      input.request.path,
    );
    const timeoutMs = input.request.timeoutMs ?? input.config.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-request-id": input.requestId,
      ...input.request.headers,
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

      if (!response.ok) {
        if (
          input.allowErrorResponseBody &&
          response.status >= 400 &&
          response.status < 500
        ) {
          return {
            status: response.status,
            data,
            headers: Object.fromEntries(response.headers.entries()),
            durationMs,
          };
        }
        throw new ProviderAdapterError({
          providerCode: input.config.providerCode,
          operation: input.operation,
          category:
            response.status === 429
              ? "PROVIDER_RATE_LIMITED"
              : response.status >= 500
                ? "PROVIDER_SERVICE_UNAVAILABLE"
                : response.status === 401
                  ? "PROVIDER_AUTHENTICATION_ERROR"
                  : response.status === 403
                    ? "PROVIDER_AUTHORIZATION_ERROR"
                    : response.status === 404
                      ? "PROVIDER_NOT_FOUND"
                      : "PROVIDER_VALIDATION_ERROR",
          safeMessage: `Provider HTTP request failed with status ${response.status}.`,
          providerErrorCode: String(response.status),
          requestId: input.requestId,
        });
      }

      return {
        status: response.status,
        data,
        headers: Object.fromEntries(response.headers.entries()),
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - started;
      if (error instanceof ProviderAdapterError) {
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

export function redactProviderHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    redacted[key] = REDACTED_HEADER_NAMES.has(key.toLowerCase())
      ? "[REDACTED]"
      : value;
  }
  return redacted;
}

export const providerHttpClient = new ProviderHttpClient();
