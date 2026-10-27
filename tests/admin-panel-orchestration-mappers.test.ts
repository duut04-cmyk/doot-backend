import { describe, expect, it } from "vitest";
import type { AdminOrchestrationPayload } from "../../admin-panel/src/data/orchestrationApiTypes.ts";
import {
  formatProviderLabel,
  isOrchestrationNotFoundError,
  mapDecisionView,
  mapEvaluationRows,
} from "../../admin-panel/src/orchestration/orchestrationMappers.ts";

const samplePayload: AdminOrchestrationPayload = {
  deliveryId: "00000000-0000-4000-8000-000000000001",
  status: "OPTION_READY",
  orchestration: {
    id: "00000000-0000-4000-8000-000000000002",
    attemptNumber: 1,
    completedAt: "2026-01-15T10:00:00.000Z",
    status: "COMPLETED",
    failureReason: null,
    selectedOption: {
      providerCode: "SHIPROCKET",
      serviceCode: "HL_1",
      quote: { amount: 99, currency: "INR" },
      estimatedDeliveryAt: "2026-01-15T11:00:00.000Z",
      selectionReason: "Highest weighted score",
    },
    evaluations: [
      {
        id: "eval-1",
        providerCode: "SHIPROCKET",
        providerServiceCode: "HL_1",
        status: "ELIGIBLE",
        serviceable: true,
        availabilityKnown: true,
        available: true,
        availableDriverCount: 3,
        quoteAvailable: true,
        quoteAmount: 99,
        quoteCurrency: "INR",
        estimatedDeliveryAt: "2026-01-15T11:00:00.000Z",
        exclusionReasons: [],
        eligibilityReasons: [],
        warnings: [],
        score: 8.5,
        scoreBreakdown: {
          price: 2,
          eta: 1.5,
          availability: 2,
          providerPriority: 1,
          serviceQuality: 2,
          applicableWeightSum: 10,
          rawWeightedScore: 8.5,
        },
        errorCategory: null,
      },
      {
        id: "eval-2",
        providerCode: "OTHER",
        providerServiceCode: null,
        status: "INELIGIBLE",
        serviceable: false,
        availabilityKnown: null,
        available: null,
        availableDriverCount: null,
        quoteAvailable: false,
        quoteAmount: null,
        quoteCurrency: null,
        estimatedDeliveryAt: null,
        exclusionReasons: ["OUT_OF_SERVICE_AREA"],
        eligibilityReasons: [],
        warnings: [],
        score: null,
        scoreBreakdown: null,
        errorCategory: null,
      },
    ],
  },
};

describe("admin-panel orchestration mappers", () => {
  it("formats provider labels with optional name map", () => {
    const names = new Map([["SHIPROCKET", "Shiprocket"]]);
    expect(formatProviderLabel("SHIPROCKET", "HL_1", names)).toBe("Shiprocket · HL_1");
    expect(formatProviderLabel("UNKNOWN", null)).toBe("UNKNOWN");
  });

  it("maps evaluation rows with selected highlight and scores", () => {
    const rows = mapEvaluationRows(samplePayload);
    expect(rows).toHaveLength(2);
    const selected = rows.find((row) => row.isSelected);
    expect(selected?.providerCode).toBe("SHIPROCKET");
    expect(selected?.rowScore).toBe("8.50");
    expect(selected?.resultVariant).toBe("accent");
    const rejected = rows.find((row) => row.providerCode === "OTHER");
    expect(rejected?.resultVariant).toBe("danger");
  });

  it("maps decision view counts and breakdown", () => {
    const decision = mapDecisionView(samplePayload);
    expect(decision.servicesEvaluated).toBe(2);
    expect(decision.eligibleCount).toBe(1);
    expect(decision.availableOptions).toBe(1);
    expect(decision.selectedScore).toBe(8.5);
    expect(decision.selectedScoreBreakdown?.rawWeightedScore).toBe(8.5);
    expect(decision.selectionReason).toBe("Highest weighted score");
  });

  it("detects orchestration not found errors", () => {
    expect(isOrchestrationNotFoundError("Orchestration not found for delivery")).toBe(
      true,
    );
    expect(isOrchestrationNotFoundError("Unauthorized")).toBe(false);
  });
});
