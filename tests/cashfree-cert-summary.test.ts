import { describe, expect, it } from "vitest";
import {
  CertStepRecorder,
  buildCertSummary,
} from "../scripts/lib/cashfree-cert/index.js";

describe("Cashfree cert summary", () => {
  it("does not claim full E2E certified when only SIMULATED PAID", () => {
    const recorder = new CertStepRecorder();
    recorder.record("Create payment", "PASS", "LIVE_API");
    const summary = buildCertSummary(recorder, {
      paidTier: "SIMULATED",
      checkoutVerified: true,
      externalWebhookVerified: false,
      refundReconciled: false,
      requireExternalWebhook: false,
    });
    expect(summary.fullSandboxE2eCertified).toBe(false);
    expect(summary.headline).toContain("AUTOMATED STEPS PASS");
  });

  it("claims full E2E only when LIVE_E2E and refund reconciled", () => {
    const recorder = new CertStepRecorder();
    recorder.record("All", "PASS", "LIVE_E2E");
    const summary = buildCertSummary(recorder, {
      paidTier: "LIVE_E2E",
      checkoutVerified: true,
      externalWebhookVerified: true,
      refundReconciled: true,
      requireExternalWebhook: true,
    });
    expect(summary.fullSandboxE2eCertified).toBe(true);
    expect(summary.headline).toContain("CERTIFIED");
  });

  it("fails automated pass when a step FAILs", () => {
    const recorder = new CertStepRecorder();
    recorder.record("Bad", "FAIL", "LIVE_API");
    const summary = buildCertSummary(recorder, {
      paidTier: "NONE",
      checkoutVerified: false,
      externalWebhookVerified: false,
      refundReconciled: false,
      requireExternalWebhook: false,
    });
    expect(summary.automatedPass).toBe(false);
  });
});
