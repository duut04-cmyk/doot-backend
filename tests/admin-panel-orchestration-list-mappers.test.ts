import { describe, expect, it } from "vitest";
import type { OrchestrationListItem } from "../../admin-panel/src/data/orchestrationListApiTypes.ts";
import {
  formatDurationMs,
  listParamsFromOrchestrationFilters,
  mapOrchestrationListRow,
  metricsFromOrchestrationListPage,
} from "../../admin-panel/src/orchestration/orchestrationListMappers.ts";
import { DEFAULT_ORCHESTRATION_FILTERS } from "../../admin-panel/src/orchestration/components/OrchestrationFilters.tsx";

const sampleItem: OrchestrationListItem = {
  orchestrationId: "00000000-0000-4000-8000-000000000010",
  attemptNumber: 1,
  orchestrationStatus: "COMPLETED",
  failureReason: null,
  startedAt: "2026-01-01T10:00:00.000Z",
  completedAt: "2026-01-01T10:00:02.500Z",
  createdAt: "2026-01-01T10:00:00.000Z",
  durationMs: 2500,
  deliveryId: "00000000-0000-4000-8000-000000000001",
  deliveryReference: "DOOT-100",
  deliveryStatus: "OPTION_READY",
  pickupAddressText: "Pickup A",
  dropAddressText: "Drop B",
  evaluationCount: 2,
  eligibleCount: 1,
  availableOptionCount: 1,
  selectedProviderCode: "MOCK",
  selectedServiceCode: "MOCK_BIKE",
  selectedScore: 8.5,
  selectionReason: "Best score",
  booking: null,
};

describe("admin-panel orchestration list mappers", () => {
  it("maps list filters to allowlisted API params", () => {
    const params = listParamsFromOrchestrationFilters(
      {
        ...DEFAULT_ORCHESTRATION_FILTERS,
        deliveryStatus: "DELIVERED",
        orchestrationStatus: "COMPLETED",
        bookingStatus: "BOOKED",
      },
      2,
      20,
      "DOOT-100",
    );
    expect(params.page).toBe(2);
    expect(params.limit).toBe(20);
    expect(params.reference).toBe("DOOT-100");
    expect(params.deliveryStatus).toBe("DELIVERED");
    expect(params.orchestrationStatus).toBe("COMPLETED");
    expect(params.bookingStatus).toBe("BOOKED");
    expect(params.from).toBeTruthy();
  });

  it("maps list rows with detail links for valid delivery ids", () => {
    const row = mapOrchestrationListRow(
      sampleItem,
      new Map([["MOCK", "Mock Provider"]]),
    );
    expect(row.runHref).toBe(
      "/orchestration/requests/00000000-0000-4000-8000-000000000010",
    );
    expect(row.deliveryHref).toBe("/deliveries/00000000-0000-4000-8000-000000000001");
    expect(row.selectedProviderLabel).toContain("Mock Provider");
    expect(row.selectedScoreDisplay).toBe("8.50");
    expect(row.durationDisplay).toBe("2.5 s");
  });

  it("formats duration and page metrics", () => {
    expect(formatDurationMs(null)).toBe("—");
    expect(formatDurationMs(500)).toBe("500 ms");
    const metrics = metricsFromOrchestrationListPage([sampleItem], 12);
    expect(metrics.totalMatching).toBe(12);
    expect(metrics.completedOnPage).toBe(1);
    expect(metrics.withSelectionOnPage).toBe(1);
  });
});
