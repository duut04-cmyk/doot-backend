import { describe, expect, it, vi } from "vitest";

/**
 * Mirrors useExclusiveAsync run semantics (single in-flight invocation).
 */
async function runExclusive(
  inFlight: { current: boolean },
  fn: () => Promise<void>,
): Promise<boolean> {
  if (inFlight.current) return false;
  inFlight.current = true;
  try {
    await fn();
    return true;
  } finally {
    inFlight.current = false;
  }
}

describe("admin-panel exclusive async retry guard", () => {
  it("runs the handler once when not busy", async () => {
    const inFlight = { current: false };
    const handler = vi.fn(async () => {});
    const ran = await runExclusive(inFlight, handler);
    expect(ran).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("skips a second concurrent invocation", async () => {
    const inFlight = { current: false };
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = vi.fn(async () => {
      await gate;
    });

    const first = runExclusive(inFlight, handler);
    const second = await runExclusive(inFlight, handler);

    expect(second).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);

    release();
    await first;
  });

  it("allows a new run after the prior run completes", async () => {
    const inFlight = { current: false };
    const handler = vi.fn(async () => {});
    await runExclusive(inFlight, handler);
    await runExclusive(inFlight, handler);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
