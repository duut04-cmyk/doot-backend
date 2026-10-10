export type CashfreeCertConfig = {
  paidTimeoutMs: number;
  refundTimeoutMs: number;
  pollIntervalMs: number;
  runSimulatedWebhook: boolean;
  requireExternalWebhook: boolean;
  resumeDeliveryId: string | null;
};

const DEFAULT_PAID_TIMEOUT_MS = 300_000;
const DEFAULT_REFUND_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 2_500;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function readCashfreeCertConfig(): CashfreeCertConfig {
  return {
    paidTimeoutMs: parsePositiveInt(
      process.env.CASHFREE_CERT_PAID_TIMEOUT_MS,
      DEFAULT_PAID_TIMEOUT_MS,
    ),
    refundTimeoutMs: parsePositiveInt(
      process.env.CASHFREE_CERT_REFUND_TIMEOUT_MS,
      DEFAULT_REFUND_TIMEOUT_MS,
    ),
    pollIntervalMs: parsePositiveInt(
      process.env.CASHFREE_CERT_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
    ),
    runSimulatedWebhook: process.env.CASHFREE_CERT_RUN_SIMULATED_WEBHOOK === "true",
    requireExternalWebhook:
      process.env.CASHFREE_CERT_REQUIRE_EXTERNAL_WEBHOOK === "true",
    resumeDeliveryId: process.env.CASHFREE_CERT_DELIVERY_ID?.trim() || null,
  };
}
