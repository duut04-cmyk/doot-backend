import { describe, expect, it } from "vitest";
import type { AdminOrchestrationRunDetail } from "../../admin-panel/src/data/orchestrationApiTypes.ts";
import { runDetailToAdminPayload } from "../../admin-panel/src/orchestration/orchestrationRunMappers.ts";

const sampleRun: AdminOrchestrationRunDetail = {
  deliveryId: "00000000-0000-4000-8000-000000000001",
  status: "OPTION_READY",
  durationMs: 1000,
  delivery: {
    reference: "DOOT-1",
    pickupAddressText: "A",
    dropAddressText: "B",
  },
  booking: null,
  orchestration: {
    id: "00000000-0000-4000-8000-000000000010",
    attemptNumber: 1,
    startedAt: "2026-01-01T10:00:00.000Z",
    createdAt: "2026-01-01T10:00:00.000Z",
    completedAt: "2026-01-01T10:00:01.000Z",
    status: "COMPLETED",
    failureReason: null,
    selectedOption: null,
    evaluations: [],
  },
};

describe("admin-panel orchestration run mappers", () => {
  it("adapts run detail to admin orchestration payload for shared UI mappers", () => {
    const payload = runDetailToAdminPayload(sampleRun);
    expect(payload.deliveryId).toBe(sampleRun.deliveryId);
    expect(payload.orchestration.id).toBe(sampleRun.orchestration.id);
    expect(payload.orchestration.evaluations).toEqual([]);
  });
});
