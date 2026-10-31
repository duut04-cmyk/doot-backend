import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { DeliveryLifecycleService } from "../src/modules/delivery/delivery-lifecycle.service.js";
import { SHIPROCKET_WEBHOOK_MAX_BODY_BYTES } from "../src/modules/provider/adapters/shiprocket/shiprocket-webhook.normalize.js";
import { shiprocketProviderWebhookService } from "../src/modules/provider/webhook/shiprocket-provider-webhook.service.js";
import { ShiprocketProviderWebhookService } from "../src/modules/provider/webhook/shiprocket-provider-webhook.service.js";
import { TrackingService } from "../src/modules/tracking/tracking.service.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryProviderWebhookEventRepository } from "./helpers/in-memory-provider-webhook-event-repository.js";
import { InMemoryTrackingRepository } from "./helpers/in-memory-tracking-repository.js";
import { TestShiprocketDeliveryLinkResolver } from "./helpers/test-shiprocket-delivery-link-resolver.js";

const webhookTestState = vi.hoisted(() => ({
  enabled: false,
  token: "http-integration-webhook-secret",
  apiKey: undefined as string | undefined,
}));

vi.mock("../src/config/env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config/env.js")>();
  return {
    ...actual,
    get env() {
      return {
        ...actual.env,
        SHIPROCKET_WEBHOOK_ENABLED: webhookTestState.enabled,
        SHIPROCKET_WEBHOOK_TOKEN: webhookTestState.token,
        SHIPROCKET_WEBHOOK_API_KEY: webhookTestState.apiKey,
      };
    },
    requireShiprocketWebhookApiKey: () => {
      if (!webhookTestState.enabled) {
        throw new Error("SHIPROCKET_WEBHOOK_ENABLED is false");
      }
      const secret = webhookTestState.token ?? webhookTestState.apiKey;
      if (!secret) {
        throw new Error("Shiprocket webhook secret is not configured");
      }
      return secret;
    },
  };
});

import { createApp } from "../src/app.js";

const ROUTE_SHIPROCKET = "/api/v1/providers/webhooks/shiprocket";
const ROUTE_TRACKING = "/api/v1/providers/webhooks/tracking";

function buildUnmatchedPayload(): string {
  return JSON.stringify({
    awb: "SR000000000IN",
    sr_order_id: "99999999",
    order_id: "99999999",
    current_status: "IN TRANSIT",
    current_status_id: 17,
    current_timestamp: "2026-03-28 10:00:00",
    is_return: false,
    scans: [
      {
        date: "2026-03-28 10:00:00",
        activity: "In transit",
        location: "Hub",
        status: "IN TRANSIT",
        status_id: 17,
      },
    ],
  });
}

describe("Shiprocket provider webhook HTTP", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let bookingRepo: InMemoryBookingRepository;
  let trackingRepo: InMemoryTrackingRepository;
  let webhookRepo: InMemoryProviderWebhookEventRepository;
  let inMemoryService: ShiprocketProviderWebhookService;
  let handleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    webhookTestState.enabled = false;
    webhookTestState.token = "http-integration-webhook-secret";
    webhookTestState.apiKey = undefined;

    deliveryRepo = new InMemoryDeliveryRepository();
    bookingRepo = new InMemoryBookingRepository();
    trackingRepo = new InMemoryTrackingRepository();
    webhookRepo = new InMemoryProviderWebhookEventRepository();
    const lifecycle = new DeliveryLifecycleService(deliveryRepo);
    const tracking = new TrackingService(deliveryRepo, trackingRepo, lifecycle);
    inMemoryService = new ShiprocketProviderWebhookService(
      webhookRepo,
      new TestShiprocketDeliveryLinkResolver(bookingRepo),
      deliveryRepo,
      tracking,
    );

    handleSpy?.mockRestore();
    handleSpy = vi
      .spyOn(shiprocketProviderWebhookService, "handle")
      .mockImplementation((input) => inMemoryService.handle(input));
  });

  function app() {
    return createApp({ exposeSwagger: false });
  }

  async function postWebhook(
    path: string,
    options?: {
      body?: string;
      apiKey?: string;
      contentType?: string;
    },
  ) {
    const req = request(app())
      .post(path)
      .set("Content-Type", options?.contentType ?? "application/json");
    if (options?.apiKey !== undefined) {
      req.set("x-api-key", options.apiKey);
    }
    return req.send(options?.body ?? buildUnmatchedPayload());
  }

  it("returns 404 when webhooks are disabled", async () => {
    webhookTestState.enabled = false;
    const response = await postWebhook(ROUTE_SHIPROCKET, {
      apiKey: webhookTestState.token,
    });
    expect(response.status).toBe(404);
    expect(response.body.error?.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it("returns 401 when webhooks are enabled and x-api-key is missing", async () => {
    webhookTestState.enabled = true;
    const response = await postWebhook(ROUTE_SHIPROCKET);
    expect(response.status).toBe(401);
    expect(response.body.error?.code).toBe(
      ErrorCodes.INVALID_PROVIDER_WEBHOOK_SIGNATURE,
    );
  });

  it("returns 401 when webhooks are enabled and x-api-key is wrong", async () => {
    webhookTestState.enabled = true;
    const response = await postWebhook(ROUTE_SHIPROCKET, {
      apiKey: "wrong-key",
    });
    expect(response.status).toBe(401);
    expect(response.body.error?.code).toBe(
      ErrorCodes.INVALID_PROVIDER_WEBHOOK_SIGNATURE,
    );
  });

  it("invokes the handler when webhooks are enabled with correct x-api-key", async () => {
    webhookTestState.enabled = true;
    const response = await postWebhook(ROUTE_SHIPROCKET, {
      apiKey: webhookTestState.token,
    });
    expect(response.status).toBe(200);
    expect(handleSpy).toHaveBeenCalledTimes(1);
    expect(handleSpy.mock.calls[0]?.[0]).toMatchObject({
      apiKey: webhookTestState.token,
    });
    expect(response.body.success).toBe(true);
  });

  it("returns 200 IGNORED for unmatched fixture without delivery changes", async () => {
    webhookTestState.enabled = true;
    const response = await postWebhook(ROUTE_SHIPROCKET, {
      apiKey: webhookTestState.token,
    });
    expect(response.status).toBe(200);
    expect(response.body.data?.processingStatus).toBe("IGNORED");
    expect(response.body.data?.reason).toBe("delivery_not_found");
    expect(trackingRepo.points).toHaveLength(0);
    expect(deliveryRepo.deliveries).toHaveLength(0);
  });

  it("returns 400 for malformed JSON", async () => {
    webhookTestState.enabled = true;
    const response = await postWebhook(ROUTE_SHIPROCKET, {
      apiKey: webhookTestState.token,
      body: "{not-json",
    });
    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it("returns 413 for oversized payload", async () => {
    webhookTestState.enabled = true;
    const padding = "x".repeat(SHIPROCKET_WEBHOOK_MAX_BODY_BYTES + 1);
    const response = await postWebhook(ROUTE_SHIPROCKET, {
      apiKey: webhookTestState.token,
      body: JSON.stringify({ awb: "SR1", sr_order_id: "1", pad: padding }),
    });
    expect(response.status).toBe(413);
    expect(response.body.error?.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it("deduplicates identical payloads at the HTTP layer", async () => {
    webhookTestState.enabled = true;
    const body = buildUnmatchedPayload();
    const first = await postWebhook(ROUTE_SHIPROCKET, {
      apiKey: webhookTestState.token,
      body,
    });
    const second = await postWebhook(ROUTE_SHIPROCKET, {
      apiKey: webhookTestState.token,
      body,
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data?.duplicate).toBe(true);
    expect(webhookRepo.events.size).toBe(1);
  });

  describe("neutral /tracking alias", () => {
    beforeEach(() => {
      webhookTestState.enabled = true;
    });

    it("returns 404 when disabled (same as /shiprocket)", async () => {
      webhookTestState.enabled = false;
      const response = await postWebhook(ROUTE_TRACKING, {
        apiKey: webhookTestState.token,
      });
      expect(response.status).toBe(404);
    });

    it("returns 401 without x-api-key", async () => {
      const response = await postWebhook(ROUTE_TRACKING);
      expect(response.status).toBe(401);
    });

    it("processes unmatched payload identically to /shiprocket", async () => {
      const body = buildUnmatchedPayload();
      const shiprocket = await postWebhook(ROUTE_SHIPROCKET, {
        apiKey: webhookTestState.token,
        body,
      });
      webhookRepo.events.clear();

      const tracking = await postWebhook(ROUTE_TRACKING, {
        apiKey: webhookTestState.token,
        body,
      });

      expect(shiprocket.body.data?.processingStatus).toBe("IGNORED");
      expect(tracking.status).toBe(200);
      expect(tracking.body.data?.processingStatus).toBe("IGNORED");
      expect(tracking.body.data?.reason).toBe("delivery_not_found");
    });
  });
});
