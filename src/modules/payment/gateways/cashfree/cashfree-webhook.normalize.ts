import type { NormalizedPaymentWebhookEvent } from "../../webhook/payment-webhook.types.js";

type JsonRecord = Record<string, unknown>;

export type CashfreeWebhookSafeDiagnostics = {
  topLevelKeys: string[];
  cashfreeWebhookType: string | null;
  hasDataOrder: boolean;
  hasDataPayment: boolean;
  hasDataRefund: boolean;
  orderIdPresent: boolean;
  paymentStatus: string | null;
  refundStatus: string | null;
};

export type CashfreeWebhookResolveResult =
  | { action: "process"; event: NormalizedPaymentWebhookEvent }
  | { action: "ignore"; reason: string; diagnostics: CashfreeWebhookSafeDiagnostics }
  | { action: "reject"; reason: string; diagnostics: CashfreeWebhookSafeDiagnostics };

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function readString(obj: JsonRecord | null, key: string): string | undefined {
  const value = obj?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readStringOrNumberId(obj: JsonRecord | null, key: string): string | null {
  const value = obj?.[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function readNumber(obj: JsonRecord | null, key: string): number | undefined {
  const value = obj?.[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function mapCashfreePaymentStatus(
  raw: string | undefined,
): NormalizedPaymentWebhookEvent["eventType"] | null {
  if (!raw) return null;
  const normalized = raw.trim().toUpperCase();
  if (
    normalized === "SUCCESS" ||
    normalized === "PAID" ||
    normalized === "PAYMENT_SUCCESS"
  ) {
    return "PAYMENT_SUCCESS";
  }
  if (
    normalized === "FAILED" ||
    normalized === "USER_DROPPED" ||
    normalized === "CANCELLED" ||
    normalized === "PAYMENT_FAILED"
  ) {
    return "PAYMENT_FAILED";
  }
  if (
    normalized === "PENDING" ||
    normalized === "ACTIVE" ||
    normalized === "PAYMENT_PENDING"
  ) {
    return "PAYMENT_PENDING";
  }
  return null;
}

function mapCashfreeRefundStatus(
  raw: string | undefined,
): NormalizedPaymentWebhookEvent["eventType"] | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (upper === "SUCCESS") return "REFUND_SUCCESS";
  if (upper === "FAILED" || upper === "CANCELLED" || upper === "REJECTED") {
    return "REFUND_FAILED";
  }
  return null;
}

/** Cashfree PG webhook `type` values (2025-01-01 / 2023-08-01). */
function mapWebhookType(
  webhookType: string | undefined,
): NormalizedPaymentWebhookEvent["eventType"] | "IGNORE" | null {
  if (!webhookType) return null;
  const upper = webhookType.trim().toUpperCase();

  if (upper === "PAYMENT_CHARGES_WEBHOOK" || upper.includes("PAYMENT_CHARGES")) {
    return "IGNORE";
  }

  if (upper.includes("USER_DROPPED")) {
    return "PAYMENT_FAILED";
  }

  if (upper.includes("REFUND")) {
    if (upper.includes("SUCCESS")) return "REFUND_SUCCESS";
    if (
      upper.includes("FAILED") ||
      upper.includes("FAILURE") ||
      upper.includes("REJECT")
    ) {
      return "REFUND_FAILED";
    }
    if (upper === "REFUND_STATUS_WEBHOOK" || upper.includes("REFUND_STATUS")) {
      return null;
    }
    return null;
  }

  if (upper.includes("SUCCESS")) return "PAYMENT_SUCCESS";
  if (upper.includes("FAILED") || upper.includes("FAILURE")) return "PAYMENT_FAILED";
  if (upper.includes("PENDING")) return "PAYMENT_PENDING";
  return null;
}

export function describeCashfreeWebhookPayload(
  payload: unknown,
): CashfreeWebhookSafeDiagnostics {
  const root = asRecord(payload);
  const data = root ? (asRecord(root.data) ?? root) : null;
  const order = data ? (asRecord(data.order) ?? data) : null;
  const payment = data ? (asRecord(data.payment) ?? null) : null;
  const refund = data ? (asRecord(data.refund) ?? null) : null;

  const gatewayOrderId =
    readString(order, "order_id") ??
    readString(data, "order_id") ??
    readString(root, "order_id") ??
    readString(refund, "order_id");

  return {
    topLevelKeys: root ? Object.keys(root).slice(0, 20) : [],
    cashfreeWebhookType: readString(root, "type") ?? null,
    hasDataOrder: Boolean(asRecord(data?.order as unknown)),
    hasDataPayment: Boolean(payment),
    hasDataRefund: Boolean(refund),
    orderIdPresent: Boolean(gatewayOrderId),
    paymentStatus:
      readString(payment, "payment_status") ??
      readString(data, "payment_status") ??
      null,
    refundStatus: readString(refund, "refund_status") ?? null,
  };
}

export function resolveCashfreePaymentWebhook(input: {
  payload: unknown;
  headerIdempotencyKey?: string | null;
}): CashfreeWebhookResolveResult {
  const diagnostics = describeCashfreeWebhookPayload(input.payload);
  const root = asRecord(input.payload);
  if (!root) {
    return {
      action: "reject",
      reason: "payload_not_object",
      diagnostics,
    };
  }

  const data = asRecord(root.data) ?? root;
  const order = asRecord(data.order) ?? data;
  const payment = asRecord(data.payment) ?? null;
  const refund = asRecord(data.refund) ?? null;

  const gatewayOrderId =
    readString(order, "order_id") ??
    readString(data, "order_id") ??
    readString(root, "order_id") ??
    readString(refund, "order_id");

  const webhookType = readString(root, "type");
  const typeMapped = mapWebhookType(webhookType);
  if (typeMapped === "IGNORE") {
    return {
      action: "ignore",
      reason: "payment_charges_or_non_lifecycle_event",
      diagnostics,
    };
  }

  const refundStatus = readString(refund, "refund_status");
  const paymentStatus =
    readString(payment, "payment_status") ??
    readString(data, "payment_status") ??
    readString(order, "order_status");

  const eventType =
    typeMapped ??
    mapCashfreeRefundStatus(refundStatus) ??
    mapCashfreePaymentStatus(paymentStatus);

  if (!eventType) {
    if (!webhookType) {
      return {
        action: "reject",
        reason: "missing_webhook_type_and_status",
        diagnostics,
      };
    }
    return {
      action: "ignore",
      reason: "unsupported_webhook_type",
      diagnostics,
    };
  }

  if (!gatewayOrderId) {
    return {
      action: "reject",
      reason: "missing_order_id",
      diagnostics,
    };
  }

  const gatewayPaymentId =
    readStringOrNumberId(payment, "cf_payment_id") ??
    readStringOrNumberId(payment, "payment_id") ??
    readStringOrNumberId(data, "cf_payment_id");

  const gatewayRefundId =
    readString(refund, "refund_id") ??
    readStringOrNumberId(refund, "cf_refund_id") ??
    readString(data, "refund_id") ??
    null;

  const amount = eventType.startsWith("REFUND")
    ? (readNumber(refund, "refund_amount") ?? readNumber(data, "refund_amount"))
    : (readNumber(payment, "payment_amount") ??
      readNumber(order, "order_amount") ??
      readNumber(data, "order_amount"));

  const currency =
    readString(refund, "refund_currency") ??
    readString(payment, "payment_currency") ??
    readString(order, "order_currency") ??
    readString(data, "order_currency");

  const paymentMethod =
    readString(payment, "payment_group") ??
    readString(payment, "payment_method") ??
    null;

  const errorDetails = asRecord(data.error_details);

  const idempotencyKey =
    input.headerIdempotencyKey?.trim() ||
    `${gatewayOrderId}:${gatewayRefundId ?? gatewayPaymentId ?? "na"}:${eventType}`;

  const event: NormalizedPaymentWebhookEvent = {
    eventType,
    gatewayOrderId,
    gatewayPaymentId,
    gatewayRefundId,
    amount,
    currency,
    paymentMethod,
    failureCode:
      eventType === "PAYMENT_FAILED"
        ? (readString(errorDetails, "error_code") ??
          readString(payment, "payment_status") ??
          "PAYMENT_FAILED")
        : eventType === "REFUND_FAILED"
          ? (refundStatus ?? "REFUND_FAILED")
          : null,
    failureMessage:
      eventType === "PAYMENT_FAILED"
        ? (readString(errorDetails, "error_description") ??
          readString(payment, "payment_message") ??
          null)
        : eventType === "REFUND_FAILED"
          ? (readString(refund, "status_description") ?? null)
          : null,
    idempotencyKey,
    metadata: {
      cashfreeWebhookType: webhookType,
    },
  };

  return { action: "process", event };
}

/** @deprecated Use resolveCashfreePaymentWebhook; kept for tests expecting null on failure. */
export function normalizeCashfreePaymentWebhook(input: {
  payload: unknown;
  headerIdempotencyKey?: string | null;
}): NormalizedPaymentWebhookEvent | null {
  const resolved = resolveCashfreePaymentWebhook(input);
  if (resolved.action === "process") {
    return resolved.event;
  }
  return null;
}
