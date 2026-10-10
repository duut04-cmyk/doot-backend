export type CertStepMode = "LIVE_API" | "LIVE_E2E" | "SIMULATED" | "BLOCKED";

export type CertStepOutcome = "PASS" | "FAIL" | "SKIP";

export type CertStep = {
  name: string;
  outcome: CertStepOutcome;
  mode: CertStepMode;
  detail?: string;
};

export class CertStepRecorder {
  readonly steps: CertStep[] = [];

  record(
    name: string,
    outcome: CertStepOutcome,
    mode: CertStepMode,
    detail?: string,
    log: (line: string) => void = (line) => {
      process.stdout.write(`${line}\n`);
    },
  ): void {
    this.steps.push({ name, outcome, mode, detail });
    const tag =
      outcome === "PASS"
        ? "PASS"
        : outcome === "FAIL"
          ? "FAIL"
          : outcome === "SKIP"
            ? "SKIP"
            : "FAIL";
    log(`[${tag}][${mode}] ${name}${detail ? ` — ${detail}` : ""}`);
  }

  failCount(): number {
    return this.steps.filter((s) => s.outcome === "FAIL").length;
  }

  hasMode(mode: CertStepMode): boolean {
    return this.steps.some((s) => s.mode === mode && s.outcome === "PASS");
  }
}
