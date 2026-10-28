/**
 * Internal harness / certification accounts use `@doot.test` emails.
 * They are not app signup customers and must not appear in admin customer lists.
 */
export const INTERNAL_TEST_EMAIL_DOMAIN = "doot.test";

export function isInternalTestCustomerEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return normalized.endsWith(`@${INTERNAL_TEST_EMAIL_DOMAIN}`);
}
