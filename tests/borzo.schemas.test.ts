import { describe, expect, it } from "vitest";
import { borzoCreateOrderResponseSchema } from "../src/modules/provider/adapters/borzo/borzo.schemas.js";

describe("Borzo response schemas", () => {
  it("preserves checkin_code on points via passthrough without mapping to DOTT OTP", () => {
    const parsed = borzoCreateOrderResponseSchema.parse({
      is_successful: true,
      order: {
        order_id: 331469,
        status: "available",
        points: [
          {
            point_id: 715225,
            address: "Pickup",
            checkin_code: "481731",
            checkin: null,
            courier_visit_datetime: null,
          },
          {
            point_id: 715226,
            address: "Drop",
            checkin_code: "629415",
            checkin: {
              recipient_full_name: "Test Recipient",
            },
            courier_visit_datetime: "2026-09-22T12:00:00+05:30",
          },
        ],
      },
    });

    const points = parsed.order?.points as Array<Record<string, unknown>>;
    expect(points?.[0]?.checkin_code).toBe("481731");
    expect(points?.[1]?.checkin_code).toBe("629415");
    expect(points?.[1]?.checkin).toEqual({
      recipient_full_name: "Test Recipient",
    });
    expect(points?.[1]?.courier_visit_datetime).toBe("2026-09-22T12:00:00+05:30");
  });
});
