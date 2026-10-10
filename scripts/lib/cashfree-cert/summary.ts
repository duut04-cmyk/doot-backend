import type { PaidTier } from "./paid-tier.js";
import type { CertStepRecorder } from "./step-recorder.js";

export type CertRunFlags = {
  paidTier: PaidTier;
  checkoutVerified: boolean;
  externalWebhookVerified: boolean;
  refundReconciled: boolean;
  requireExternalWebhook: boolean;
};

export type CertSummary = {
  stepsPassed: number;
  stepsTotal: number;
  failCount: number;
  automatedPass: boolean;
  fullSandboxE2eCertified: boolean;
  headline: string;
  notes: string[];
};

export function buildCertSummary(
  recorder: CertStepRecorder,
  flags: CertRunFlags,
): CertSummary {
  const failCount = recorder.failCount();
  const stepsTotal = recorder.steps.length;
  const stepsPassed = stepsTotal - failCount;
  const automatedPass = failCount === 0;

  const notes: string[] = [];

  if (flags.paidTier === "NONE") {
    notes.push(
      "Payment not PAID — browser checkout or simulated webhook not completed.",
    );
  }
  if (flags.paidTier === "SIMULATED") {
    notes.push(
      "PAID via simulated webhook (sim- cf_payment_id), not external Cashfree notify.",
    );
  }
  if (flags.paidTier === "LIVE_E2E") {
    notes.push(
      "PAID with non-simulated gateway payment id — consistent with real checkout/webhook.",
    );
  }
  if (flags.requireExternalWebhook && !flags.externalWebhookVerified) {
    notes.push(
      "BLOCKED: external webhook not verified (CASHFREE_CERT_REQUIRE_EXTERNAL_WEBHOOK=true).",
    );
  }
  if (!flags.refundReconciled) {
    notes.push("Refund not reconciled to SUCCESS in this run.");
  }

  const fullSandboxE2eCertified =
    automatedPass &&
    flags.checkoutVerified &&
    flags.externalWebhookVerified &&
    flags.refundReconciled &&
    flags.paidTier === "LIVE_E2E";

  let headline: string;
  if (fullSandboxE2eCertified) {
    headline =
      "CASHFREE SANDBOX E2E: CERTIFIED (live checkout, webhook, refund reconciled)";
  } else if (automatedPass) {
    headline =
      "CASHFREE SANDBOX: AUTOMATED STEPS PASS (full E2E not certified — see LIVE_E2E / BLOCKED tags)";
  } else {
    headline = "CASHFREE SANDBOX: FAIL";
  }

  return {
    stepsPassed,
    stepsTotal,
    failCount,
    automatedPass,
    fullSandboxE2eCertified,
    headline,
    notes,
  };
}
