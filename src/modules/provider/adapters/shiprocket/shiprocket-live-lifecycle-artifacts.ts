import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProviderHttpRequest } from "../provider-http-client.js";
import { resolveProviderRequestUrl } from "../provider-http-client.js";
import type { ProviderRuntimeConfig } from "../provider-config.types.js";
import { SHIPROCKET_PROVIDER_CODE } from "./shiprocket.constants.js";

const REDACTED_HEADER_NAMES = new Set([
  "authorization",
  "x-api-key",
  "api-key",
  "x-auth-token",
]);

const REDACT_JSON_KEYS = new Set([
  "authorization",
  "token",
  "password",
  "api_key",
  "apikey",
  "x-api-key",
]);

const MASK_IDENTIFIER_JSON_KEYS = new Set([
  "billing_customer_name",
  "shipping_customer_name",
  "customer_name",
  "billing_phone",
  "shipping_phone",
  "phone",
  "billing_email",
  "shipping_email",
  "email",
]);

const REDACT_ADDRESS_KEYS = new Set([
  "billing_address",
  "shipping_address",
  "address",
  "address_1",
  "address_2",
  "pickup_address",
  "delivery_address",
  "drop_address",
]);

const REDACT_COORD_KEYS = new Set(["latitude", "longitude", "lat", "lng"]);

const PRESERVE_NAME_KEYS = new Set([
  "courier_name",
  "status",
  "track_status",
  "package_type",
]);

export type ShiprocketLiveLifecycleHttpExchangeOutcome =
  "success" | "http_error" | "timeout" | "network_error" | "parse_error";

export type ShiprocketLiveLifecycleHttpExchange = {
  sequence: number;
  timestamp: string;
  durationMs: number;
  method: string;
  path: string;
  urlHost: string;
  sanitizedHeaders: Record<string, string>;
  requestBody: unknown;
  status: number | null;
  responseBody: unknown;
  outcome: ShiprocketLiveLifecycleHttpExchangeOutcome;
  errorCategory?: string | null;
  safeErrorMessage?: string | null;
  extractedIds: {
    providerOrderId: string | null;
    shipmentId: string | null;
    awb: string | null;
    courierId: string | null;
  };
};

export type ShiprocketLiveLifecycleDbSnapshot = {
  label: string;
  timestamp: string;
  deliveryId: string | null;
  deliveryStatus: string | null;
  bookingId: string | null;
  bookingStatus: string | null;
  providerOrderId: string | null;
  providerReference: string | null;
  metadataKeys: string[];
  cancellationId?: string | null;
  cancellationStatus?: string | null;
};

export type ShiprocketLiveLifecycleArtifactRecorder = {
  runId: string;
  runDirectory: string;
  recordHttpExchange: (
    exchange: Omit<ShiprocketLiveLifecycleHttpExchange, "sequence">,
  ) => Promise<void>;
  recordDbSnapshot: (snapshot: ShiprocketLiveLifecycleDbSnapshot) => Promise<void>;
};

let activeRecorder: ShiprocketLiveLifecycleArtifactRecorder | null = null;

export function getShiprocketLiveLifecycleArtifactRecorder(): ShiprocketLiveLifecycleArtifactRecorder | null {
  return activeRecorder;
}

export function setShiprocketLiveLifecycleArtifactRecorder(
  recorder: ShiprocketLiveLifecycleArtifactRecorder | null,
): void {
  activeRecorder = recorder;
}

export async function createShiprocketLiveLifecycleArtifactRecorder(input: {
  runId: string;
  reportsRoot?: string;
}): Promise<ShiprocketLiveLifecycleArtifactRecorder> {
  const reportsRoot =
    input.reportsRoot ?? join(process.cwd(), "reports", "shiprocket-live-lifecycle");
  const runDirectory = join(reportsRoot, input.runId);
  await mkdir(reportsRoot, { recursive: true });
  await mkdir(runDirectory, { recursive: false });

  let sequence = 0;

  const recorder: ShiprocketLiveLifecycleArtifactRecorder = {
    runId: input.runId,
    runDirectory,
    recordHttpExchange: async (exchange) => {
      sequence += 1;
      const payload: ShiprocketLiveLifecycleHttpExchange = {
        sequence,
        ...exchange,
        sanitizedHeaders: sanitizeHeaders(exchange.sanitizedHeaders),
        requestBody: redactArtifactJson(exchange.requestBody),
        responseBody: redactArtifactJson(exchange.responseBody),
      };
      const base = `${String(sequence).padStart(3, "0")}-${slugifyPath(exchange.path)}`;
      await writeFile(
        join(runDirectory, `${base}-exchange.json`),
        JSON.stringify(payload, null, 2),
        "utf8",
      );
    },
    recordDbSnapshot: async (snapshot) => {
      const file = join(
        runDirectory,
        `db-${slugifyPath(snapshot.label)}-${Date.now()}.json`,
      );
      await writeFile(file, JSON.stringify(snapshot, null, 2), "utf8");
    },
  };

  return recorder;
}

export function sanitizeHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (REDACTED_HEADER_NAMES.has(key.toLowerCase())) {
      output[key] = "[REDACTED]";
    } else {
      output[key] = value;
    }
  }
  return output;
}

function classifyRedactArtifactKey(
  key: string,
): "secret" | "mask" | "address" | "coord" | "none" {
  const lower = key.toLowerCase();
  if (REDACT_JSON_KEYS.has(lower)) {
    return "secret";
  }
  if (REDACT_COORD_KEYS.has(lower)) {
    return "coord";
  }
  if (REDACT_ADDRESS_KEYS.has(lower)) {
    return "address";
  }
  if (MASK_IDENTIFIER_JSON_KEYS.has(lower)) {
    return "mask";
  }
  if (PRESERVE_NAME_KEYS.has(lower)) {
    return "none";
  }
  if (lower.endsWith("_phone") || lower.endsWith("_mobile") || lower === "mobile") {
    return "mask";
  }
  if (lower.endsWith("_email") || lower === "email") {
    return "mask";
  }
  if (lower.includes("address") && !lower.includes("address_id")) {
    return "address";
  }
  if (
    lower.endsWith("_name") ||
    lower === "contact_name" ||
    lower === "first_name" ||
    lower === "last_name"
  ) {
    return "mask";
  }
  if (lower === "pickup" || lower === "drop" || lower === "contact") {
    return "none";
  }
  return "none";
}

export function redactArtifactJson(value: unknown, depth = 0): unknown {
  if (depth > 32) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactArtifactJson(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    const record = value as Record<string, unknown>;
    for (const [key, nested] of Object.entries(record)) {
      const lower = key.toLowerCase();
      if (
        lower === "name" &&
        ("sku" in record || "selling_price" in record || "units" in record)
      ) {
        output[key] = nested;
        continue;
      }
      const kind = classifyRedactArtifactKey(key);
      if (kind === "secret") {
        output[key] = "[REDACTED]";
        continue;
      }
      if (kind === "coord") {
        output[key] = "[REDACTED_COORD]";
        continue;
      }
      if (kind === "address" && typeof nested === "string") {
        output[key] = "[REDACTED_ADDRESS]";
        continue;
      }
      if (kind === "mask") {
        output[key] =
          typeof nested === "string" || typeof nested === "number"
            ? maskIdentifier(String(nested))
            : "[REDACTED]";
        continue;
      }
      output[key] = redactArtifactJson(nested, depth + 1);
    }
    return output;
  }
  return value;
}

function maskIdentifier(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) {
    return "****";
  }
  return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
}

function slugifyPath(path: string): string {
  return (
    path
      .replace(/^\//, "")
      .replace(/[/:?&=]+/g, "-")
      .slice(0, 80) || "root"
  );
}

export function extractIdsFromHttpBodies(input: {
  requestBody: unknown;
  responseBody: unknown;
}): ShiprocketLiveLifecycleHttpExchange["extractedIds"] {
  const req = asRecord(input.requestBody);
  const res = asRecord(input.responseBody);
  const data = asRecord(res.data);

  const shipmentFromReq = req.shipment_id;
  const courierFromReq = req.courier_id;

  return {
    providerOrderId: pickString(res.order_id, data.id, res.id),
    shipmentId: pickString(res.shipment_id, data.shipment_id, shipmentFromReq),
    awb: pickString(res.awb_code, res.awb, data.awb_code),
    courierId: pickString(res.courier_id, data.courier_id, courierFromReq),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pickString(...candidates: unknown[]): string | null {
  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

export async function maybeRecordShiprocketHttpExchange(input: {
  config: ProviderRuntimeConfig;
  request: ProviderHttpRequest;
  requestId: string;
  sanitizedHeaders: Record<string, string>;
  status: number | null;
  requestBody: unknown;
  responseBody: unknown;
  durationMs: number;
  outcome: ShiprocketLiveLifecycleHttpExchangeOutcome;
  errorCategory?: string | null;
  safeErrorMessage?: string | null;
}): Promise<void> {
  const recorder = activeRecorder;
  if (!recorder || input.config.providerCode !== SHIPROCKET_PROVIDER_CODE) {
    return;
  }

  const url = resolveProviderRequestUrl(input.config.baseUrl, input.request.path);
  let urlHost: string;
  try {
    urlHost = new URL(url).hostname;
  } catch {
    urlHost = "unknown";
  }

  await recorder.recordHttpExchange({
    timestamp: new Date().toISOString(),
    durationMs: input.durationMs,
    method: input.request.method,
    path: input.request.path,
    urlHost,
    sanitizedHeaders: input.sanitizedHeaders,
    requestBody: input.requestBody,
    status: input.status,
    responseBody: input.responseBody,
    outcome: input.outcome,
    errorCategory: input.errorCategory ?? null,
    safeErrorMessage: input.safeErrorMessage ?? null,
    extractedIds: extractIdsFromHttpBodies({
      requestBody: input.requestBody,
      responseBody: input.responseBody,
    }),
  });
}
