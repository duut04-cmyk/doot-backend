import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ProviderAdapterError } from "../../contracts/provider-error.js";
import type { ProviderRuntimeConfig } from "../provider-config.types.js";
import { ProviderHttpClient } from "../provider-http-client.js";
import {
  SHIPROCKET_CANCEL_ORDERS_PATH,
  SHIPROCKET_JSON_READ_HEADERS,
  SHIPROCKET_ORDER_SHOW_PATH_PREFIX,
  SHIPROCKET_TRACK_AWB_PATH_PREFIX,
  SHIPROCKET_TRACK_SHIPMENT_PATH_PREFIX,
} from "./shiprocket.constants.js";
import { ShiprocketAuthService } from "./shiprocket-auth.service.js";
import {
  isValidShiprocketAwbCode,
  isValidShiprocketOrderId,
  isValidShiprocketShipmentId,
  parseShiprocketOrderShowDetails,
} from "./shiprocket-order-show.parse.js";
import {
  assertShiprocketSandboxHttpsBaseUrl,
  createShiprocketSandboxProbeRuntimeConfig,
  DEFAULT_PROBE_MAX_RESPONSE_BYTES,
  DEFAULT_PROBE_TIMEOUT_MS,
  parseShiprocketProbeHttpBody,
  sanitizeShiprocketProbeResponseBody,
  ShiprocketSandboxProbeError,
  SHIPROCKET_SANDBOX_HOST,
} from "./shiprocket-sandbox-probe.js";

export const SHIPROCKET_SANDBOX_CANCEL_CONFIRM_PHRASE = "I_UNDERSTAND_ONCE";

export type ShiprocketSandboxCancelPhase = "read" | "cancel" | "reconcile";

const IDENTIFIER_JSON_KEYS = new Set([
  "awb",
  "awb_code",
  "awbcode",
  "order_id",
  "channel_order_id",
  "phone",
  "email",
  "billing_phone",
  "billing_email",
  "shipping_phone",
  "shipping_email",
  "customer_name",
  "billing_customer_name",
  "shipping_customer_name",
]);

export function assertSandboxNumericOrderId(orderId: string): string {
  const trimmed = orderId.trim();
  if (!isValidShiprocketOrderId(trimmed)) {
    throw new ShiprocketSandboxProbeError(
      "VALIDATION",
      "order-id must be a numeric Shiprocket order id (data.id), not channel id or UUID.",
    );
  }
  return trimmed;
}

export function maskIdentifier(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) {
    return "****";
  }
  return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
}

export function sanitizeSandboxCancelArtifact(
  body: unknown,
  maxBytes: number = DEFAULT_PROBE_MAX_RESPONSE_BYTES,
): unknown {
  const base = sanitizeShiprocketProbeResponseBody(body, maxBytes);
  return redactIdentifiers(base, 0);
}

function shouldRedactArtifactKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (IDENTIFIER_JSON_KEYS.has(lower)) {
    return true;
  }
  if (lower === "id") {
    return true;
  }
  return (
    lower.includes("address") ||
    lower.includes("phone") ||
    lower.includes("postcode") ||
    lower.includes("pincode") ||
    lower.includes("latitude") ||
    lower.includes("longitude") ||
    lower.includes("lat") ||
    lower.includes("lng") ||
    lower.includes("name")
  );
}

function redactIdentifiers(value: unknown, depth: number): unknown {
  if (depth > 24) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactIdentifiers(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (shouldRedactArtifactKey(key)) {
        output[key] =
          typeof nested === "string" || typeof nested === "number"
            ? maskIdentifier(String(nested))
            : "[redacted]";
        continue;
      }
      output[key] = redactIdentifiers(nested, depth + 1);
    }
    return output;
  }
  return value;
}

export type ShiprocketSandboxOrderSnapshot = {
  orderIdMasked: string;
  status: string | null;
  statusCode: string | null;
  subStatus: string | null;
  shipmentIdMasked: string | null;
  awbMasked: string | null;
};

export function summarizeOrderShow(
  body: unknown,
): ShiprocketSandboxOrderSnapshot | null {
  const details = parseShiprocketOrderShowDetails(body);
  if (!details) {
    return null;
  }
  return {
    orderIdMasked: maskIdentifier(details.orderId),
    status: details.status,
    statusCode: details.statusCode,
    subStatus: details.subStatus,
    shipmentIdMasked: details.shipmentId ? maskIdentifier(details.shipmentId) : null,
    awbMasked: details.awbCode ? maskIdentifier(details.awbCode) : null,
  };
}

async function writeArtifact(
  runDir: string,
  filename: string,
  payload: unknown,
): Promise<string> {
  await mkdir(runDir, { recursive: true, mode: 0o700 });
  const path = join(runDir, filename);
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return path;
}

async function getBearerToken(input: {
  runtimeConfig: ProviderRuntimeConfig;
  requestId: string;
  auth: ShiprocketAuthService;
}): Promise<string> {
  try {
    return await input.auth.getBearerToken({
      config: input.runtimeConfig,
      requestId: input.requestId,
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
}

async function httpRequest(input: {
  runtimeConfig: ProviderRuntimeConfig;
  http: ProviderHttpClient;
  auth: ShiprocketAuthService;
  requestId: string;
  operation: "getBooking" | "cancelBooking" | "getTracking";
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  timeoutMs: number;
}) {
  const token = await getBearerToken({
    runtimeConfig: input.runtimeConfig,
    requestId: input.requestId,
    auth: input.auth,
  });

  try {
    return await input.http.request({
      config: input.runtimeConfig,
      operation: input.operation,
      requestId: input.requestId,
      request: {
        method: input.method,
        path: input.path,
        headers: {
          ...SHIPROCKET_JSON_READ_HEADERS,
          authorization: `Bearer ${token}`,
        },
        body: input.body,
        timeoutMs: input.timeoutMs,
      },
      allowErrorResponseBody: true,
    });
  } catch (error) {
    if (error instanceof ProviderAdapterError) {
      if (error.category === "PROVIDER_TIMEOUT") {
        throw new ShiprocketSandboxProbeError(
          "TIMEOUT",
          "Shiprocket request timed out.",
        );
      }
      throw new ShiprocketSandboxProbeError("PROVIDER_ERROR", error.safeMessage);
    }
    throw error;
  }
}

export type ShiprocketSandboxCancelVerifyInput = {
  baseUrl: string;
  orderId: string;
  phase: ShiprocketSandboxCancelPhase;
  confirmCancel?: string;
  runDir: string;
  requestId?: string;
  timeoutMs?: number;
  auth?: ShiprocketAuthService;
  http?: ProviderHttpClient;
};

export type ShiprocketSandboxCancelVerifyResult = {
  ok: boolean;
  phase: ShiprocketSandboxCancelPhase;
  sandboxHost: string;
  orderShow?: {
    httpStatus: number;
    snapshot: ShiprocketSandboxOrderSnapshot | null;
    artifactPath: string;
  };
  tracking?: {
    httpStatus: number;
    artifactPath: string;
    trackKind: "awb" | "shipment";
  };
  cancel?: {
    httpStatus: number;
    artifactPath: string;
  };
  message?: string;
};

export async function runShiprocketSandboxCancelVerify(
  input: ShiprocketSandboxCancelVerifyInput,
): Promise<ShiprocketSandboxCancelVerifyResult> {
  const origin = assertShiprocketSandboxHttpsBaseUrl(input.baseUrl);
  const orderId = assertSandboxNumericOrderId(input.orderId);
  const timeoutMs = input.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const requestId = input.requestId ?? "shiprocket-sandbox-cancel-verify";
  const runtimeConfig = createShiprocketSandboxProbeRuntimeConfig({
    baseUrl: origin,
    timeoutMs,
  });
  const http = input.http ?? new ProviderHttpClient();
  const auth = input.auth ?? new ShiprocketAuthService();

  if (input.phase === "cancel") {
    if (input.confirmCancel !== SHIPROCKET_SANDBOX_CANCEL_CONFIRM_PHRASE) {
      throw new ShiprocketSandboxProbeError(
        "VALIDATION",
        `cancel phase requires --confirm-cancel ${SHIPROCKET_SANDBOX_CANCEL_CONFIRM_PHRASE}`,
      );
    }
  }

  const result: ShiprocketSandboxCancelVerifyResult = {
    ok: true,
    phase: input.phase,
    sandboxHost: SHIPROCKET_SANDBOX_HOST,
  };

  const shouldRead =
    input.phase === "read" || input.phase === "cancel" || input.phase === "reconcile";
  if (shouldRead) {
    const prefix =
      input.phase === "reconcile" ? "post" : input.phase === "cancel" ? "pre" : "read";
    const showResponse = await httpRequest({
      runtimeConfig,
      http,
      auth,
      requestId,
      operation: "getBooking",
      method: "GET",
      path: `${SHIPROCKET_ORDER_SHOW_PATH_PREFIX}${encodeURIComponent(orderId)}`,
      timeoutMs,
    });
    const showBody = sanitizeSandboxCancelArtifact(
      parseShiprocketProbeHttpBody(
        JSON.stringify(showResponse.data),
        DEFAULT_PROBE_MAX_RESPONSE_BYTES,
      ),
    );
    const artifactPath = await writeArtifact(
      input.runDir,
      `${prefix}-order-show.json`,
      {
        httpStatus: showResponse.status,
        snapshot: summarizeOrderShow(showResponse.data),
        body: showBody,
      },
    );
    result.orderShow = {
      httpStatus: showResponse.status,
      snapshot: summarizeOrderShow(showResponse.data),
      artifactPath,
    };

    const details = parseShiprocketOrderShowDetails(showResponse.data);
    if (details) {
      const awb = isValidShiprocketAwbCode(details.awbCode)
        ? details.awbCode.trim()
        : null;
      const shipmentId = isValidShiprocketShipmentId(details.shipmentId)
        ? details.shipmentId.trim()
        : null;
      const trackPath = awb
        ? `${SHIPROCKET_TRACK_AWB_PATH_PREFIX}${encodeURIComponent(awb)}`
        : shipmentId
          ? `${SHIPROCKET_TRACK_SHIPMENT_PATH_PREFIX}${encodeURIComponent(shipmentId)}`
          : null;
      if (trackPath) {
        const trackResponse = await httpRequest({
          runtimeConfig,
          http,
          auth,
          requestId,
          operation: "getTracking",
          method: "GET",
          path: trackPath,
          timeoutMs,
        });
        const trackBody = sanitizeSandboxCancelArtifact(
          parseShiprocketProbeHttpBody(
            JSON.stringify(trackResponse.data),
            DEFAULT_PROBE_MAX_RESPONSE_BYTES,
          ),
        );
        const trackArtifactPath = await writeArtifact(
          input.runDir,
          `${prefix}-tracking.json`,
          {
            httpStatus: trackResponse.status,
            trackKind: awb ? "awb" : "shipment",
            body: trackBody,
          },
        );
        result.tracking = {
          httpStatus: trackResponse.status,
          artifactPath: trackArtifactPath,
          trackKind: awb ? "awb" : "shipment",
        };
      }
    }
  }

  if (input.phase === "cancel") {
    const cancelResponse = await httpRequest({
      runtimeConfig,
      http,
      auth,
      requestId,
      operation: "cancelBooking",
      method: "POST",
      path: SHIPROCKET_CANCEL_ORDERS_PATH,
      body: { ids: [Number.parseInt(orderId, 10)] },
      timeoutMs,
    });
    const cancelBodyRaw =
      cancelResponse.data === undefined || cancelResponse.data === null
        ? {}
        : cancelResponse.data;
    const cancelBody = sanitizeSandboxCancelArtifact(
      typeof cancelBodyRaw === "string"
        ? parseShiprocketProbeHttpBody(cancelBodyRaw, DEFAULT_PROBE_MAX_RESPONSE_BYTES)
        : cancelBodyRaw,
    );
    const artifactPath = await writeArtifact(input.runDir, "cancel-response.json", {
      httpStatus: cancelResponse.status,
      body: cancelBody,
    });
    result.cancel = {
      httpStatus: cancelResponse.status,
      artifactPath,
    };
    result.message =
      "Cancel POST completed once. Run --phase reconcile after waiting; do not auto-retry cancel on timeout or ambiguous HTTP.";
  }

  if (input.phase === "reconcile") {
    result.message =
      "Reconcile-only read complete. Compare post-order-show artifacts across timestamps manually; never retry cancel without explicit review.";
  }

  if (input.phase === "read") {
    result.message = "Read-only order-show/tracking complete. No cancel POST was sent.";
  }

  return result;
}
