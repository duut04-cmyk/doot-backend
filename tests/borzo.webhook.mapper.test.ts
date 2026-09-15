import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildBorzoProviderEventKey,
  mapBorzoWebhookCallbackToNormalizedEvent,
} from "../src/modules/provider/adapters/borzo/borzo.webhook.mapper.js";
import { parseBorzoWebhookCallback } from "../src/modules/provider/adapters/borzo/borzo.webhook.schemas.js";
import {
  normalizeBorzoDeliveryStatus,
  normalizeBorzoOrderStatus,
} from "../src/modules/provider/adapters/borzo/borzo.webhook.status.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/borzo");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}

describe("Borzo webhook mapper", () => {
  it("normalizes order_created callback", () => {
    const callback = parseBorzoWebhookCallback(loadFixture("order-created.json"));
    const normalized = mapBorzoWebhookCallbackToNormalizedEvent(
      callback,
      "2026-09-14T07:30:00.000Z",
    );
    expect(normalized.providerCode).toBe("BORZO");
    expect(normalized.eventType).toBe("order_created");
    expect(normalized.providerBookingId).toBe("1250032");
    expect(normalized.status).toBe("available");
    expect(normalized.driver).toBeNull();
    expect(normalized.tracking).toBeNull();
    expect(normalized.metadata?.callbackCategory).toBe("order");
  });

  it("normalizes delivery_changed callback with tracking fields", () => {
    const callback = parseBorzoWebhookCallback(
      loadFixture("delivery-changed.json"),
    );
    const normalized = mapBorzoWebhookCallbackToNormalizedEvent(
      callback,
      "2026-09-14T07:30:00.000Z",
    );
    expect(normalized.providerReference).toBe("11712");
    expect(normalized.providerBookingId).toBe("1250032");
    expect(normalized.tracking?.latitude).toBe(28.6210537);
    expect(normalized.tracking?.longitude).toBe(77.0817532);
    expect(normalized.tracking?.trackingUrl).toBe(
      "https://example.test/track/11712",
    );
    expect(normalized.tracking?.eta).toBeNull();
    expect(normalized.driver).toBeNull();
  });

  it("keeps null coordinates when provider sends null", () => {
    const callback = parseBorzoWebhookCallback(
      loadFixture("delivery-created.json"),
    );
    const normalized = mapBorzoWebhookCallbackToNormalizedEvent(
      callback,
      "2026-09-14T07:30:00.000Z",
    );
    expect(normalized.tracking?.latitude).toBeNull();
    expect(normalized.tracking?.longitude).toBeNull();
    expect(normalized.tracking?.trackingUrl).toBeNull();
  });

  it("builds different event keys for status changes on same delivery", () => {
    const created = parseBorzoWebhookCallback(
      loadFixture("delivery-created.json"),
    );
    const changed = parseBorzoWebhookCallback(
      loadFixture("delivery-changed.json"),
    );
    expect(buildBorzoProviderEventKey(created)).not.toBe(
      buildBorzoProviderEventKey(changed),
    );
  });

  it("builds identical event keys for exact duplicate callbacks", () => {
    const first = parseBorzoWebhookCallback(loadFixture("order-created.json"));
    const second = parseBorzoWebhookCallback(loadFixture("order-created.json"));
    expect(buildBorzoProviderEventKey(first)).toBe(
      buildBorzoProviderEventKey(second),
    );
  });

  it("maps unknown provider statuses to UNKNOWN metadata hints", () => {
    expect(normalizeBorzoOrderStatus("active")).toBe("UNKNOWN");
    expect(normalizeBorzoDeliveryStatus("active")).toBe("UNKNOWN");
    expect(normalizeBorzoDeliveryStatus("finished")).toBe("DELIVERED");
    expect(normalizeBorzoOrderStatus("canceled")).toBe("CANCELLED");
  });
});
