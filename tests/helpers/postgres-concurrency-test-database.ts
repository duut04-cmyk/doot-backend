/**
 * Guard for disposable PostgreSQL used only by payment concurrency integration tests.
 * Intentionally strict — extend ALLOWED_HOSTS in code when CI needs another local target.
 */

export const POSTGRES_CONCURRENCY_TEST_DATABASE_NAME = "doot_pg_concurrency_test";

/** Local disposable hosts only. Add entries explicitly for new CI runners. */
export const POSTGRES_CONCURRENCY_TEST_ALLOWED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
]);

const DISALLOWED_HOST_SUBSTRINGS = [
  "supabase.co",
  "amazonaws.com",
  "rds.amazonaws.com",
  "neon.tech",
  "render.com",
  "herokuapp.com",
];

function parseDatabaseName(url: URL): string {
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!name) {
    throw new Error("TEST_DATABASE_URL must include a database name (path segment).");
  }
  return name;
}

/**
 * Validates TEST_DATABASE_URL for concurrency integration tests.
 * @throws Error when the URL is missing, malformed, or not an allowed disposable target.
 */
export function assertPostgresConcurrencyTestDatabaseUrl(
  raw: string | undefined,
): string {
  if (raw === undefined || raw.trim() === "") {
    throw new Error(
      "TEST_DATABASE_URL is required for PostgreSQL concurrency integration tests.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid URL.");
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error(
      'TEST_DATABASE_URL must use the "postgresql:" or "postgres:" scheme.',
    );
  }

  const host = parsed.hostname.toLowerCase();
  const hostLower = host;

  for (const fragment of DISALLOWED_HOST_SUBSTRINGS) {
    if (hostLower.includes(fragment)) {
      throw new Error(
        `TEST_DATABASE_URL host "${host}" is not permitted for disposable concurrency tests.`,
      );
    }
  }

  if (!POSTGRES_CONCURRENCY_TEST_ALLOWED_HOSTS.has(host)) {
    throw new Error(
      `TEST_DATABASE_URL host "${host}" is not in the allowed local disposable-test host list.`,
    );
  }

  const databaseName = parseDatabaseName(parsed);
  if (databaseName !== POSTGRES_CONCURRENCY_TEST_DATABASE_NAME) {
    throw new Error(
      `TEST_DATABASE_URL database must be exactly "${POSTGRES_CONCURRENCY_TEST_DATABASE_NAME}" (got "${databaseName}").`,
    );
  }

  return raw;
}
