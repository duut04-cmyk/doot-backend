/** Message persisted by {@link ProviderService.recordConnectionTestResult} on failure. */
export const PROVIDER_HEALTH_CHECK_FAILED_MESSAGE = "Provider health check failed.";

const ALLOWED_HEALTH_CHECK_ERRORS = new Set<string>([
  PROVIDER_HEALTH_CHECK_FAILED_MESSAGE,
]);

const SENSITIVE_HEALTH_ERROR_PATTERN =
  /(?:bearer\s+\S+|authorization\s*:\s*\S+|api[_-]?key\s*[=:]\s*\S+|password\s*[=:]\s*\S+|client_secret\s*[=:]\s*\S+|(?:^|\W)secret\s*[=:]\s*\S+|token\s*[=:]\s*[A-Za-z0-9._-]{8,}|access_token\s*[=:]\s*\S+)/i;

/**
 * Sanitizes stored health-check errors before admin API exposure.
 * Only explicitly approved messages are returned; all other stored text is collapsed
 * to the canonical safe failure message. Does not mutate persistence or health checks.
 */
export function sanitizeProviderHealthCheckError(
  raw: string | null | undefined,
): string | null {
  if (raw == null) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (ALLOWED_HEALTH_CHECK_ERRORS.has(trimmed)) {
    return trimmed;
  }
  if (SENSITIVE_HEALTH_ERROR_PATTERN.test(trimmed)) {
    return PROVIDER_HEALTH_CHECK_FAILED_MESSAGE;
  }
  return PROVIDER_HEALTH_CHECK_FAILED_MESSAGE;
}
