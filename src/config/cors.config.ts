import type { CorsOptions } from "cors";

/** Local dev defaults when explicit frontend URLs are not configured. */
export const DEFAULT_DEV_CORS_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
] as const;

export function resolveCorsAllowedOrigins(
  frontendUrl?: string,
  adminFrontendUrl?: string,
): string[] {
  const origins = [frontendUrl, adminFrontendUrl].filter((value): value is string =>
    Boolean(value),
  );
  return [...new Set(origins)];
}

type CorsOriginCallback = NonNullable<CorsOptions["origin"]>;

/**
 * Builds a CORS origin callback. Never uses reflective `origin: true`.
 * - Explicit env URLs → allowlist only.
 * - Unset in development/test → localhost defaults.
 * - Unset in production → deny cross-origin browser requests.
 */
export function createCorsOriginCallback(options: {
  allowedOrigins: string[];
  nodeEnv: string;
}): CorsOriginCallback {
  const allowlist =
    options.allowedOrigins.length > 0
      ? options.allowedOrigins
      : options.nodeEnv === "development" || options.nodeEnv === "test"
        ? [...DEFAULT_DEV_CORS_ORIGINS]
        : [];

  return (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (allowlist.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  };
}
