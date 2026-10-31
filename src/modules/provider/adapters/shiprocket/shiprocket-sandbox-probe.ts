import { ProviderAdapterError } from "../../contracts/provider-error.js";
import type { ProviderRuntimeConfig } from "../provider-config.types.js";
import { ProviderHttpClient } from "../provider-http-client.js";
import { ShiprocketAuthService } from "./shiprocket-auth.service.js";
import { SHIPROCKET_JSON_READ_HEADERS } from "./shiprocket.constants.js";
import { buildHyperlocalServiceabilityPath } from "./shiprocket-hyperlocal.query.js";

export const SHIPROCKET_SANDBOX_HOST = "api-sandbox.shiprocket.in";

const INDIAN_POSTAL_CODE = /^\d{6}$/;

export const DEFAULT_PROBE_TIMEOUT_MS = 15_000;
export const DEFAULT_PROBE_MAX_RESPONSE_BYTES = 256 * 1024;

const SENSITIVE_JSON_KEYS = new Set([
  "token",
  "password",
  "authorization",
  "access_token",
  "refresh_token",
  "api_key",
  "secret",
  "email",
]);

export type ShiprocketSandboxProbeErrorCode =
  | "SANDBOX_HOST"
  | "VALIDATION"
  | "AUTHENTICATION"
  | "TIMEOUT"
  | "RESPONSE_TOO_LARGE"
  | "MALFORMED_RESPONSE"
  | "PROVIDER_ERROR";

export class ShiprocketSandboxProbeError extends Error {
  readonly code: ShiprocketSandboxProbeErrorCode;

  constructor(code: ShiprocketSandboxProbeErrorCode, message: string) {
    super(message);
    this.name = "ShiprocketSandboxProbeError";
    this.code = code;
  }
}

export type ShiprocketSandboxProbeLocationInput = {
  latitude: number;
  longitude: number;
  postcode?: string;
};

export type ShiprocketSandboxProbeInput = {
  baseUrl: string;
  weightKg: number;
  cod?: string | number;
  pickup: ShiprocketSandboxProbeLocationInput;
  drop: ShiprocketSandboxProbeLocationInput;
  requestId?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  resolvePostcode: (input: {
    latitude: number;
    longitude: number;
    label: string;
  }) => Promise<string>;
  auth?: ShiprocketAuthService;
  http?: ProviderHttpClient;
};

export type ShiprocketSandboxProbeResult = {
  sandboxHost: string;
  serviceabilityHttpStatus: number;
  serviceabilityBody: unknown;
};

export function assertShiprocketSandboxHttpsBaseUrl(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new ShiprocketSandboxProbeError(
      "SANDBOX_HOST",
      "Shiprocket probe base URL is invalid.",
    );
  }

  if (parsed.protocol !== "https:") {
    throw new ShiprocketSandboxProbeError(
      "SANDBOX_HOST",
      "Shiprocket sandbox probe requires HTTPS.",
    );
  }

  if (parsed.hostname.toLowerCase() !== SHIPROCKET_SANDBOX_HOST) {
    throw new ShiprocketSandboxProbeError(
      "SANDBOX_HOST",
      `Refusing Shiprocket host "${parsed.hostname}" — only ${SHIPROCKET_SANDBOX_HOST} is allowed.`,
    );
  }

  return parsed.origin;
}

export function parseIndianPostcode(value: string, label: string): string {
  const normalized = value.trim();
  if (!INDIAN_POSTAL_CODE.test(normalized)) {
    throw new ShiprocketSandboxProbeError(
      "VALIDATION",
      `${label} must be a 6-digit Indian postal code.`,
    );
  }
  return normalized;
}

export function parseCoordinate(value: string, label: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new ShiprocketSandboxProbeError(
      "VALIDATION",
      `${label} must be a finite number.`,
    );
  }
  return parsed;
}

export function createShiprocketSandboxProbeRuntimeConfig(input: {
  baseUrl: string;
  timeoutMs?: number;
}): ProviderRuntimeConfig {
  const origin = assertShiprocketSandboxHttpsBaseUrl(input.baseUrl);
  const timeoutMs = input.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  return {
    providerId: "shiprocket-sandbox-probe",
    providerCode: "SHIPROCKET",
    environment: "SANDBOX",
    status: "ACTIVE",
    enabled: true,
    integrationStatus: "READY",
    baseUrl: origin,
    timeoutMs,
    connectTimeoutMs: timeoutMs,
    maxRetries: 0,
    retryDelayMs: 0,
    capabilities: ["SERVICEABILITY", "PRICING"],
    services: [],
    credentials: {},
  };
}

export function sanitizeShiprocketProbeResponseBody(
  body: unknown,
  maxBytes: number,
): unknown {
  const serialized = JSON.stringify(body);
  if (serialized.length > maxBytes) {
    throw new ShiprocketSandboxProbeError(
      "RESPONSE_TOO_LARGE",
      `Shiprocket response exceeds ${maxBytes} bytes.`,
    );
  }
  return redactSensitiveJson(body, 0);
}

function redactSensitiveJson(value: unknown, depth: number): unknown {
  if (depth > 24) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveJson(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (SENSITIVE_JSON_KEYS.has(key.toLowerCase())) {
        output[key] = "[redacted]";
        continue;
      }
      output[key] = redactSensitiveJson(nested, depth + 1);
    }
    return output;
  }
  return value;
}

export function parseShiprocketProbeHttpBody(
  rawText: string,
  maxBytes: number,
): unknown {
  if (rawText.length > maxBytes) {
    throw new ShiprocketSandboxProbeError(
      "RESPONSE_TOO_LARGE",
      `Shiprocket response exceeds ${maxBytes} bytes.`,
    );
  }
  if (!rawText.trim()) {
    return {};
  }
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    throw new ShiprocketSandboxProbeError(
      "MALFORMED_RESPONSE",
      "Shiprocket response was not valid JSON.",
    );
  }
}

export async function runShiprocketSandboxServiceabilityProbe(
  input: ShiprocketSandboxProbeInput,
): Promise<ShiprocketSandboxProbeResult> {
  assertShiprocketSandboxHttpsBaseUrl(input.baseUrl);
  const timeoutMs = input.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const maxResponseBytes = input.maxResponseBytes ?? DEFAULT_PROBE_MAX_RESPONSE_BYTES;
  const requestId = input.requestId ?? "shiprocket-sandbox-probe";

  const pickupPostcode = input.pickup.postcode
    ? parseIndianPostcode(input.pickup.postcode, "Pickup postcode")
    : parseIndianPostcode(
        await input.resolvePostcode({
          latitude: input.pickup.latitude,
          longitude: input.pickup.longitude,
          label: "Pickup",
        }),
        "Pickup postcode",
      );

  const deliveryPostcode = input.drop.postcode
    ? parseIndianPostcode(input.drop.postcode, "Delivery postcode")
    : parseIndianPostcode(
        await input.resolvePostcode({
          latitude: input.drop.latitude,
          longitude: input.drop.longitude,
          label: "Delivery",
        }),
        "Delivery postcode",
      );

  const runtimeConfig = createShiprocketSandboxProbeRuntimeConfig({
    baseUrl: input.baseUrl,
    timeoutMs,
  });

  const auth = input.auth ?? new ShiprocketAuthService();
  const http = input.http ?? new ProviderHttpClient();

  let bearerToken: string;
  try {
    bearerToken = await auth.getBearerToken({
      config: runtimeConfig,
      requestId,
    });
  } catch (error) {
    if (error instanceof ProviderAdapterError) {
      if (error.category === "PROVIDER_AUTHENTICATION_ERROR") {
        throw new ShiprocketSandboxProbeError(
          "AUTHENTICATION",
          "Shiprocket sandbox authentication failed.",
        );
      }
      throw new ShiprocketSandboxProbeError("PROVIDER_ERROR", error.safeMessage);
    }
    throw error;
  }

  const path = buildHyperlocalServiceabilityPath({
    pickupPostcode,
    deliveryPostcode,
    latFrom: input.pickup.latitude,
    longFrom: input.pickup.longitude,
    latTo: input.drop.latitude,
    longTo: input.drop.longitude,
    weightKg: input.weightKg,
    cod: input.cod ?? "0",
  });

  let response;
  try {
    response = await http.request({
      config: runtimeConfig,
      operation: "checkServiceability",
      requestId,
      request: {
        method: "GET",
        path,
        headers: {
          ...SHIPROCKET_JSON_READ_HEADERS,
          authorization: `Bearer ${bearerToken}`,
        },
        timeoutMs,
      },
      allowErrorResponseBody: true,
    });
  } catch (error) {
    if (error instanceof ProviderAdapterError) {
      if (error.category === "PROVIDER_TIMEOUT") {
        throw new ShiprocketSandboxProbeError(
          "TIMEOUT",
          "Shiprocket serviceability request timed out.",
        );
      }
      throw new ShiprocketSandboxProbeError("PROVIDER_ERROR", error.safeMessage);
    }
    throw error;
  }

  const rawText = JSON.stringify(response.data);
  const parsedBody = parseShiprocketProbeHttpBody(rawText, maxResponseBytes);
  const sanitizedBody = sanitizeShiprocketProbeResponseBody(
    parsedBody,
    maxResponseBytes,
  );

  return {
    sandboxHost: SHIPROCKET_SANDBOX_HOST,
    serviceabilityHttpStatus: response.status,
    serviceabilityBody: sanitizedBody,
  };
}
