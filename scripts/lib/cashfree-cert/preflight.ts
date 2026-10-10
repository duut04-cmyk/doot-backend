import { CASHFREE_SANDBOX_PG_BASE_URL } from "./constants.js";

export type CertEnvSnapshot = {
  paymentGateway: string;
  cashfreeEnabled: boolean;
  cashfreeEnvironment: string;
  hasClientId: boolean;
  hasClientSecret: boolean;
  pgBaseUrl: string;
};

export type PreflightResult =
  { ok: true; snapshot: CertEnvSnapshot } | { ok: false; errors: string[] };

export function validateCertPreflight(env: CertEnvSnapshot): PreflightResult {
  const errors: string[] = [];

  if (env.cashfreeEnvironment === "production") {
    errors.push("CASHFREE_ENVIRONMENT must not be production");
  }
  if (env.cashfreeEnvironment !== "sandbox") {
    errors.push("CASHFREE_ENVIRONMENT must be sandbox");
  }
  if (!env.cashfreeEnabled) {
    errors.push("CASHFREE_ENABLED must be true");
  }
  if (env.paymentGateway !== "cashfree") {
    errors.push("PAYMENT_GATEWAY must be cashfree (cert process and running backend)");
  }
  if (!env.hasClientId || !env.hasClientSecret) {
    errors.push("CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET are required");
  }
  if (env.pgBaseUrl !== CASHFREE_SANDBOX_PG_BASE_URL) {
    errors.push(`Cashfree PG base URL must be exactly ${CASHFREE_SANDBOX_PG_BASE_URL}`);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, snapshot: env };
}

export function readCertEnvFromProcess(): CertEnvSnapshot {
  return {
    paymentGateway: (process.env.PAYMENT_GATEWAY ?? "stub").trim().toLowerCase(),
    cashfreeEnabled: process.env.CASHFREE_ENABLED === "true",
    cashfreeEnvironment: (process.env.CASHFREE_ENVIRONMENT ?? "sandbox")
      .trim()
      .toLowerCase(),
    hasClientId: Boolean(process.env.CASHFREE_CLIENT_ID?.trim()),
    hasClientSecret: Boolean(process.env.CASHFREE_CLIENT_SECRET?.trim()),
    pgBaseUrl: process.env.CASHFREE_PG_BASE_URL_OVERRIDE?.trim() ?? "",
  };
}

/** Uses getCashfreePgBaseUrl when override not set — caller should merge pgBaseUrl from config. */
export function mergePgBaseUrl(
  snapshot: CertEnvSnapshot,
  resolvedPgBaseUrl: string,
): CertEnvSnapshot {
  return {
    ...snapshot,
    pgBaseUrl: snapshot.pgBaseUrl || resolvedPgBaseUrl,
  };
}
