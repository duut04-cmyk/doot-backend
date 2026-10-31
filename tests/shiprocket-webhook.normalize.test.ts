import { describe, expect, it } from "vitest";
import {
  normalizeShiprocketTrackingWebhook,
  SHIPROCKET_WEBHOOK_MAX_BODY_BYTES,
} from "../src/modules/provider/adapters/shiprocket/shiprocket-webhook.normalize.js";

describe("normalizeShiprocketTrackingWebhook", () => {
  it("normalizes multi-scan payloads with distinct stable event ids", () => {
    const result = normalizeShiprocketTrackingWebhook({
      awb: "SR123456789IN",
      sr_order_id: 16161616,
      order_id: 16161616,
      current_status: "IN TRANSIT",
      current_status_id: 17,
      current_timestamp: "2026-03-28 10:00:00",
      is_return: false,
      scans: [
        {
          date: "2026-03-28 10:00:00",
          activity: "Picked up",
          location: "Delhi",
          status: "PICKED UP",
          status_id: 6,
        },
        {
          date: "2026-03-28 14:30:00",
          activity: "In transit",
          location: "Delhi Hub",
          status: "IN TRANSIT",
          status_id: 17,
        },
      ],
    });

    expect(result.action).toBe("events");
    if (result.action !== "events") {
      return;
    }
    expect(result.scans).toHaveLength(2);
    expect(result.scans[0]?.providerEventId).not.toBe(result.scans[1]?.providerEventId);
    expect(result.scans[0]?.providerEventId).toMatch(/^[a-f0-9]{32}$/);
    expect(result.scans[0]?.metadata.shiprocketCurrentStatusId).toBe("6");
  });

  it("supports top-level status when scans are absent", () => {
    const result = normalizeShiprocketTrackingWebhook({
      awb: "SR123456789IN",
      sr_order_id: "9001",
      shipment_status: "OUT FOR DELIVERY",
      current_timestamp: "2026-03-29 08:00:00",
    });

    expect(result.action).toBe("events");
    if (result.action !== "events") {
      return;
    }
    expect(result.scans).toHaveLength(1);
    expect(result.scans[0]?.status).toBe("OUT FOR DELIVERY");
  });

  it("ignores pending or missing trackable status", () => {
    const result = normalizeShiprocketTrackingWebhook({
      awb: "SR123456789IN",
      sr_order_id: "9001",
      current_status: "PENDING",
      current_timestamp: "2026-03-29 08:00:00",
    });
    expect(result.action).toBe("ignore");
  });

  it("rejects payloads without identifiers", () => {
    const result = normalizeShiprocketTrackingWebhook({
      current_status: "IN TRANSIT",
      current_timestamp: "2026-03-29 08:00:00",
    });
    expect(result.action).toBe("reject");
  });

  it("rejects too many scans", () => {
    const scans = Array.from({ length: 201 }, (_, index) => ({
      date: `2026-03-28 10:${String(index % 60).padStart(2, "0")}:00`,
      status: "IN TRANSIT",
      activity: `Scan ${index}`,
    }));
    const result = normalizeShiprocketTrackingWebhook({
      awb: "SR123456789IN",
      sr_order_id: "9001",
      scans,
    });
    expect(result.action).toBe("reject");
  });

  it("marks return payloads for lifecycle skip", () => {
    const result = normalizeShiprocketTrackingWebhook({
      awb: "SR123456789IN",
      sr_order_id: "9001",
      is_return: true,
      current_status: "IN TRANSIT",
      current_timestamp: "2026-03-29 08:00:00",
    });
    expect(result.action).toBe("events");
    if (result.action !== "events") {
      return;
    }
    expect(result.scans[0]?.skipForwardDeliveryLifecycle).toBe(true);
    expect(result.scans[0]?.metadata.shiprocketIsReturn).toBe(true);
  });

  it("normalizes delivery-attempt and RTO-style scan labels without lifecycle skip", () => {
    const attempt = normalizeShiprocketTrackingWebhook({
      awb: "SR123456789IN",
      sr_order_id: "9001",
      is_return: false,
      scans: [
        {
          date: "2026-03-30 15:00:00",
          activity: "Customer unavailable",
          location: "Mumbai",
          status: "Delivery attempted",
          status_id: 21,
        },
      ],
    });
    expect(attempt.action).toBe("events");
    if (attempt.action !== "events") {
      return;
    }
    expect(attempt.scans[0]?.status).toBe("Delivery attempted");
    expect(attempt.scans[0]?.skipForwardDeliveryLifecycle).toBe(false);

    const rto = normalizeShiprocketTrackingWebhook({
      awb: "SR123456789IN",
      sr_order_id: "9001",
      is_return: true,
      current_status: "RTO IN TRANSIT",
      current_timestamp: "2026-03-30 16:00:00",
    });
    expect(rto.action).toBe("events");
    if (rto.action !== "events") {
      return;
    }
    expect(rto.isReturn).toBe(true);
    expect(rto.scans[0]?.skipForwardDeliveryLifecycle).toBe(true);
  });

  it("documents max body size guard used by service", () => {
    expect(SHIPROCKET_WEBHOOK_MAX_BODY_BYTES).toBeGreaterThan(0);
  });
});
