import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseShiprocketTrackingResponse } from "../src/modules/provider/adapters/shiprocket/shiprocket-tracking.parse.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/shiprocket");

describe("Shiprocket tracking parsing", () => {
  it("parses AWB tracking with activities and track_url", () => {
    const body = JSON.parse(
      readFileSync(join(fixtureDir, "track-awb-success.json"), "utf8"),
    );
    const parsed = parseShiprocketTrackingResponse(body);
    expect(parsed.availability).toBe("AVAILABLE");
    expect(parsed.rawStatus).toBe("IN TRANSIT");
    expect(parsed.trackingUrl).toBe("https://shiprocket.example/track/SR123456789IN");
    expect(parsed.courierName).toBe("QuickCourier");
    expect(parsed.activities).toHaveLength(1);
    expect(parsed.providerEventId).toMatch(/^[a-f0-9]{32}$/);
  });

  it("treats track_status 0 as PENDING", () => {
    const body = JSON.parse(
      readFileSync(join(fixtureDir, "track-pending.json"), "utf8"),
    );
    const parsed = parseShiprocketTrackingResponse(body);
    expect(parsed.availability).toBe("PENDING");
    expect(parsed.pendingReason).toBe("No activities found yet");
  });

  it("returns UNKNOWN for unparseable body", () => {
    const parsed = parseShiprocketTrackingResponse(null);
    expect(parsed.availability).toBe("UNKNOWN");
  });

  it("handles legacy flat shipment_status fixture", () => {
    const body = JSON.parse(
      readFileSync(join(fixtureDir, "track-shipment-success.json"), "utf8"),
    );
    const parsed = parseShiprocketTrackingResponse(body);
    expect(parsed.availability).toBe("AVAILABLE");
    expect(parsed.rawStatus).toBe("IN TRANSIT");
  });

  it("handles empty arrays and null optional fields", () => {
    const parsed = parseShiprocketTrackingResponse({
      tracking_data: {
        track_status: 1,
        shipment_status: "Manifested",
        shipment_track: [],
        shipment_track_activities: [],
      },
    });
    expect(parsed.availability).toBe("AVAILABLE");
    expect(parsed.activities).toEqual([]);
    expect(parsed.trackingUrl).toBeNull();
  });
});
