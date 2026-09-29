import type { NormalizedPaymentWebhookEvent } from "../../webhook/payment-webhook.types.js";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function readString(obj: JsonRecord | null, key: string): string | undefined {
  const value = obj?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
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

function mapWebhookType(
  webhookType: string | undefined,
): NormalizedPaymentWebhookEvent["eventType"] | null {
  if (!webhookType) return null;
  const upper = webhookType.toUpperCase();
  if (upper.includes("SUCCESS")) return "PAYMENT_SUCCESS";
  if (upper.includes("FAILED") || upper.includes("FAILURE")) return "PAYMENT_FAILED";
  if (upper.includes("PENDING")) return "PAYMENT_PENDING";
  return null;
}

export function normalizeCashfreePaymentWebhook(input: {
  payload: unknown;
  headerIdempotencyKey?: string | null;
}): NormalizedPaymentWebhookEvent | null {
  const root = asRecord(input.payload);
  if (!root) {
    return null;
  }

  const data = asRecord(root.data) ?? root;
  const order = asRecord(data.order) ?? data;
  const payment = asRecord(data.payment) ?? data;

  const gatewayOrderId =
    readString(order, "order_id") ??
    readString(data, "order_id") ??
    readString(root, "order_id");
  if (!gatewayOrderId) {
    return null;
  }

  const paymentStatus =
    readString(payment, "payment_status") ??
    readString(data, "payment_status") ??
    readString(order, "order_status");

  const eventType =
    mapCashfreePaymentStatus(paymentStatus) ?? mapWebhookType(readString(root, "type"));

  if (!eventType) {
    return null;
  }

  const gatewayPaymentId =
    readString(payment, "cf_payment_id") ??
    readString(payment, "payment_id") ??
    readString(data, "cf_payment_id") ??
    null;

  const amount =
    readNumber(payment, "payment_amount") ??
    readNumber(order, "order_amount") ??
    readNumber(data, "order_amount");

  const currency =
    readString(payment, "payment_currency") ??
    readString(order, "order_currency") ??
    readString(data, "order_currency");

  const paymentMethod =
    readString(payment, "payment_group") ??
    readString(payment, "payment_method") ??
    null;

  const idempotencyKey =
    input.headerIdempotencyKey?.trim() ||
    `${gatewayOrderId}:${gatewayPaymentId ?? "na"}:${eventType}`;

  return {
    eventType,
    gatewayOrderId,
    gatewayPaymentId,
    amount,
    currency,
    paymentMethod,
    failureCode:
      eventType === "PAYMENT_FAILED"
        ? (readString(payment, "payment_status") ?? "PAYMENT_FAILED")
        : null,
    failureMessage:
      eventType === "PAYMENT_FAILED"
        ? (readString(payment, "payment_message") ?? null)
        : null,
    idempotencyKey,
    metadata: {
      cashfreeWebhookType: readString(root, "type"),
    },
  };
}
