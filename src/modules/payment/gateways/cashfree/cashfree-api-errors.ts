type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function readString(obj: JsonRecord | null, key: string): string | undefined {
  const value = obj?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

/** Sanitized Cashfree API error fields for logs and safe client messages. */
export function extractCashfreeApiError(body: unknown): {
  message?: string;
  code?: string;
  type?: string;
} {
  const root = asRecord(body);
  if (!root) {
    return {};
  }

  const nestedError = asRecord(root.error);
  const message =
    readString(root, "message") ??
    readString(nestedError, "message") ??
    readString(root, "error_description");
  const code =
    readString(root, "code") ??
    readString(nestedError, "code") ??
    readString(root, "error_code");
  const type = readString(root, "type") ?? readString(nestedError, "type");

  return { message, code, type };
}

export function buildSafeCashfreeClientMessage(error: {
  message?: string;
  code?: string;
  type?: string;
}): string {
  if (error.message) {
    return error.message;
  }
  if (error.code) {
    return `Cashfree order creation failed (${error.code}).`;
  }
  return "Cashfree order creation failed.";
}
