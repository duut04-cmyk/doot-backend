import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { errorHandlerMiddleware } from "../src/core/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/core/middleware/request-id.js";
import { logger } from "../src/config/logger.js";
import { BorzoWebhookController } from "../src/modules/provider/provider.webhook.controller.js";
import { createBorzoWebhookRouter } from "../src/modules/provider/provider.webhook.routes.js";
import { BorzoWebhookService } from "../src/modules/provider/provider.webhook.service.js";
import { ProviderWebhookProcessor } from "../src/modules/provider/provider.webhook.processor.js";
import { createTestBorzoWebhookSignature } from "./helpers/borzo-webhook-signature.js";
import { InMemoryProviderWebhookEventRepository } from "./helpers/in-memory-webhook-event-repository.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/borzo");
const TEST_SECRET = "test-borzo-callback-secret-min-16-chars";

function loadFixtureRaw(name: string): Buffer {
  return Buffer.from(readFileSync(join(fixturesDir, name), "utf8"));
}

describe("Borzo webhook HTTP endpoint", () => {
  let repo: InMemoryProviderWebhookEventRepository;
  let service: BorzoWebhookService;

  beforeEach(() => {
    process.env.BORZO_CALLBACK_SECRET = TEST_SECRET;
    repo = new InMemoryProviderWebhookEventRepository();
    service = new BorzoWebhookService(repo, new ProviderWebhookProcessor());
  });

  function buildApp(testService: BorzoWebhookService = service) {
    const app = express();
    app.use(requestIdMiddleware);
    app.use(
      "/api/v1/providers/borzo",
      createBorzoWebhookRouter(new BorzoWebhookController(testService)),
    );
    app.use(errorHandlerMiddleware);
    return app;
  }

  it("accepts a valid signed order_created callback", async () => {
    const rawBody = loadFixtureRaw("order-created.json");
    const app = buildApp();
    const response = await request(app)
      .post("/api/v1/providers/borzo/webhooks")
      .set("Content-Type", "application/json")
      .set("X-DV-Signature", createTestBorzoWebhookSignature(rawBody, TEST_SECRET))
      .send(rawBody.toString("utf8"));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true, duplicate: false });
    expect(repo.events).toHaveLength(1);
    expect(repo.events[0]?.providerOrderId).toBe("1250032");
    expect(repo.events[0]?.processingStatus).toBe("IGNORED");
  });

  it("accepts a valid signed delivery_changed callback", async () => {
    const rawBody = loadFixtureRaw("delivery-changed.json");
    const app = buildApp();
    const response = await request(app)
      .post("/api/v1/providers/borzo/webhooks")
      .set("Content-Type", "application/json")
      .set("X-DV-Signature", createTestBorzoWebhookSignature(rawBody, TEST_SECRET))
      .send(rawBody.toString("utf8"));

    expect(response.status).toBe(200);
    expect(response.body.received).toBe(true);
    expect(repo.events[0]?.providerDeliveryId).toBe("11712");
    expect(repo.events[0]?.normalizedEvent).toBeTruthy();
  });

  it("returns duplicate=true for exact retries", async () => {
    const rawBody = loadFixtureRaw("order-created.json");
    const app = buildApp();
    const signature = createTestBorzoWebhookSignature(rawBody, TEST_SECRET);

    await request(app)
      .post("/api/v1/providers/borzo/webhooks")
      .set("Content-Type", "application/json")
      .set("X-DV-Signature", signature)
      .send(rawBody.toString("utf8"));

    const duplicate = await request(app)
      .post("/api/v1/providers/borzo/webhooks")
      .set("Content-Type", "application/json")
      .set("X-DV-Signature", signature)
      .send(rawBody.toString("utf8"));

    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toEqual({ received: true, duplicate: true });
    expect(repo.events).toHaveLength(1);
  });

  it("treats delivery status changes as new events", { timeout: 15000 }, async () => {
    const created = loadFixtureRaw("delivery-created.json");
    const changed = loadFixtureRaw("delivery-changed.json");
    const app = buildApp();

    await request(app)
      .post("/api/v1/providers/borzo/webhooks")
      .set("Content-Type", "application/json")
      .set("X-DV-Signature", createTestBorzoWebhookSignature(created, TEST_SECRET))
      .send(created.toString("utf8"));

    const response = await request(app)
      .post("/api/v1/providers/borzo/webhooks")
      .set("Content-Type", "application/json")
      .set("X-DV-Signature", createTestBorzoWebhookSignature(changed, TEST_SECRET))
      .send(changed.toString("utf8"));

    expect(response.status).toBe(200);
    expect(response.body.duplicate).toBe(false);
    expect(repo.events).toHaveLength(2);
  });

  it("rejects missing signature with 401", async () => {
    const rawBody = loadFixtureRaw("order-created.json");
    const app = buildApp();
    const response = await request(app)
      .post("/api/v1/providers/borzo/webhooks")
      .set("Content-Type", "application/json")
      .send(rawBody.toString("utf8"));

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe(
      ErrorCodes.INVALID_PROVIDER_WEBHOOK_SIGNATURE,
    );
    expect(repo.events).toHaveLength(0);
  });

  it("rejects invalid signature with 401", async () => {
    const rawBody = loadFixtureRaw("order-created.json");
    const app = buildApp();
    const response = await request(app)
      .post("/api/v1/providers/borzo/webhooks")
      .set("Content-Type", "application/json")
      .set("X-DV-Signature", "deadbeef")
      .send(rawBody.toString("utf8"));

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe(
      ErrorCodes.INVALID_PROVIDER_WEBHOOK_SIGNATURE,
    );
  });

  it("rejects modified body after signing", async () => {
    const rawBody = loadFixtureRaw("order-created.json");
    const app = buildApp();
    const response = await request(app)
      .post("/api/v1/providers/borzo/webhooks")
      .set("Content-Type", "application/json")
      .set("X-DV-Signature", createTestBorzoWebhookSignature(rawBody, TEST_SECRET))
      .send(rawBody.toString("utf8").replace("available", "active"));

    expect(response.status).toBe(401);
  });

  it("rejects malformed JSON with 400 after valid signature", async () => {
    const rawBody = Buffer.from("{not-json", "utf8");
    const app = buildApp();
    const response = await request(app)
      .post("/api/v1/providers/borzo/webhooks")
      .set("Content-Type", "application/json")
      .set("X-DV-Signature", createTestBorzoWebhookSignature(rawBody, TEST_SECRET))
      .send(rawBody.toString("utf8"));

    expect(response.status).toBe(400);
  });

  it("rejects unknown event type with 400", async () => {
    const payload = {
      event_datetime: "2026-09-14T12:57:09+05:30",
      event_type: "unknown_event",
    };
    const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
    const app = buildApp();
    const response = await request(app)
      .post("/api/v1/providers/borzo/webhooks")
      .set("Content-Type", "application/json")
      .set("X-DV-Signature", createTestBorzoWebhookSignature(rawBody, TEST_SECRET))
      .send(rawBody.toString("utf8"));

    expect(response.status).toBe(400);
  });

  it("returns 500 when processing fails and marks event failed", async () => {
    const rawBody = loadFixtureRaw("order-created.json");
    const failingProcessor = {
      process: vi.fn().mockRejectedValue(new Error("processor failed")),
    };
    const failingService = new BorzoWebhookService(
      repo,
      failingProcessor as unknown as ProviderWebhookProcessor,
    );
    const app = buildApp(failingService);

    const response = await request(app)
      .post("/api/v1/providers/borzo/webhooks")
      .set("Content-Type", "application/json")
      .set("X-DV-Signature", createTestBorzoWebhookSignature(rawBody, TEST_SECRET))
      .send(rawBody.toString("utf8"));

    expect(response.status).toBe(500);
    expect(repo.events[0]?.processingStatus).toBe("FAILED");
  });

  it("does not leak secrets in logs on signature failure", async () => {
    const warnSpy = vi.spyOn(logger, "warn");
    const rawBody = loadFixtureRaw("order-created.json");
    const app = buildApp();

    await request(app)
      .post("/api/v1/providers/borzo/webhooks")
      .set("Content-Type", "application/json")
      .set("X-DV-Signature", "bad-signature")
      .send(rawBody.toString("utf8"));

    const logged = JSON.stringify(warnSpy.mock.calls);
    expect(logged).not.toContain(TEST_SECRET);
    expect(logged).not.toContain("bad-signature");
    warnSpy.mockRestore();
  });
});
