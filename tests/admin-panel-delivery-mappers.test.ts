import { describe, expect, it } from "vitest";
import {
  deliveryStatusLabel,
  deliveryStatusPillKey,
} from "../../admin-panel/src/deliveries/deliveryStatus.ts";
import {
  dateRangeToIsoBounds,
  listParamsFromFilters,
  mapTimeline,
} from "../../admin-panel/src/deliveries/deliveryMappers.ts";
const DEFAULT_DELIVERY_FILTERS = {
  search: "",
  deliveryStatus: "all" as const,
  dateRange: "30d" as const,
};

describe("admin-panel delivery mappers", () => {
  it("maps backend delivery statuses to labels and pill keys", () => {
    expect(deliveryStatusLabel("IN_TRANSIT")).toBe("In transit");
    expect(deliveryStatusPillKey("CREATED")).toBe("pending");
    expect(deliveryStatusPillKey("DELIVERED")).toBe("delivered");
  });

  it("builds ISO bounds for supported date ranges", () => {
    const range = dateRangeToIsoBounds("7d");
    expect(range.from).toBeTruthy();
    expect(range.to).toBeTruthy();
    expect(new Date(range.from!).getTime()).toBeLessThanOrEqual(
      new Date(range.to!).getTime(),
    );
    expect(dateRangeToIsoBounds("custom")).toEqual({});
  });

  it("maps list filters to allowlisted API params", () => {
    const params = listParamsFromFilters(
      {
        ...DEFAULT_DELIVERY_FILTERS,
        deliveryStatus: "DELIVERED",
        search: "DOOT-100",
      },
      2,
      20,
      "DOOT-100",
    );
    expect(params.page).toBe(2);
    expect(params.limit).toBe(20);
    expect(params.status).toBe("DELIVERED");
    expect(params.reference).toBe("DOOT-100");
    expect(params.from).toBeTruthy();
  });

  it("maps history timeline events to display entries", () => {
    const entries = mapTimeline({
      delivery: {
        id: "00000000-0000-4000-8000-000000000001",
        reference: "DOOT-1",
        status: "DELIVERED",
        specialInstructions: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
      pickup: {
        addressText: "A",
        contactName: "A",
        contactPhone: {},
        instructions: null,
        latitude: null,
        longitude: null,
      },
      drop: {
        addressText: "B",
        contactName: "B",
        contactPhone: {},
        instructions: null,
        latitude: null,
        longitude: null,
      },
      package: {
        packageType: "FOOD",
        sizeTier: "MEDIUM",
        description: null,
        weightKg: 1,
        lengthCm: null,
        widthCm: null,
        heightCm: null,
        quantity: 1,
        requirements: [],
        photos: [],
      },
      schedule: {
        mode: "ASAP",
        timezone: "Asia/Kolkata",
        scheduledAt: null,
        windowStart: null,
        windowEnd: null,
      },
      timeline: [
        {
          id: "e1",
          fromStatus: "CREATED",
          toStatus: "BOOKED",
          source: "BOOKING",
          reason: "confirmed",
          createdAt: "2026-01-01T12:00:00.000Z",
        },
      ],
      orchestration: null,
      booking: null,
      cancellation: null,
      tracking: { latest: null },
      rating: null,
      feedback: null,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe("Booked");
    expect(entries[0]?.description).toBe("confirmed");
  });
});
