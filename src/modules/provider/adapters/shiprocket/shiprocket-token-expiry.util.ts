import { SHIPROCKET_TOKEN_FALLBACK_TTL_MS } from "./shiprocket.constants.js";

const EXPLICIT_EXPIRY_FIELD_NAMES = [
  "expires_at",
  "expiresAt",
  "token_expires_at",
  "tokenExpiresAt",
  "expiry",
  "expire_at",
] as const;

function parseEpochSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      return asNumber > 1_000_000_000_000
        ? Math.floor(asNumber / 1000)
        : Math.floor(asNumber);
    }
    const asDate = Date.parse(value);
    if (!Number.isNaN(asDate)) {
      return Math.floor(asDate / 1000);
    }
  }
  return null;
}

function readExplicitExpiryFromLoginBody(loginBody: unknown): number | null {
  if (!loginBody || typeof loginBody !== "object") {
    return null;
  }
  const record = loginBody as Record<string, unknown>;
  for (const key of EXPLICIT_EXPIRY_FIELD_NAMES) {
    const epoch = parseEpochSeconds(record[key]);
    if (epoch != null) {
      return epoch;
    }
  }
  const nested = record.data;
  if (nested && typeof nested === "object") {
    const nestedRecord = nested as Record<string, unknown>;
    for (const key of EXPLICIT_EXPIRY_FIELD_NAMES) {
      const epoch = parseEpochSeconds(nestedRecord[key]);
      if (epoch != null) {
        return epoch;
      }
    }
  }
  return null;
}

/** JWT `exp` hint only — not used for authenticity. */
export function readJwtExpHintEpochSeconds(token: string): number | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const payloadJson = Buffer.from(parts[1]!, "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson) as { exp?: unknown };
    return parseEpochSeconds(payload.exp);
  } catch {
    return null;
  }
}

export function resolveShiprocketTokenExpiresAt(input: {
  loginBody: unknown;
  token: string;
  issuedAt: Date;
}): Date {
  const nowMs = input.issuedAt.getTime();
  const explicitEpoch = readExplicitExpiryFromLoginBody(input.loginBody);
  if (explicitEpoch != null) {
    const explicitMs = explicitEpoch * 1000;
    if (explicitMs > nowMs) {
      return new Date(explicitMs);
    }
  }

  const jwtExpEpoch = readJwtExpHintEpochSeconds(input.token);
  if (jwtExpEpoch != null) {
    const jwtExpMs = jwtExpEpoch * 1000;
    if (jwtExpMs > nowMs) {
      return new Date(jwtExpMs);
    }
  }

  return new Date(nowMs + SHIPROCKET_TOKEN_FALLBACK_TTL_MS);
}

export function shouldRefreshShiprocketToken(
  expiresAt: Date,
  now: Date = new Date(),
  refreshIfRemainingMs: number,
): boolean {
  const remainingMs = expiresAt.getTime() - now.getTime();
  return remainingMs <= refreshIfRemainingMs;
}

export function sanitizeShiprocketAuthRefreshError(message: string): string {
  const trimmed = message.trim().slice(0, 500);
  return trimmed.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}
