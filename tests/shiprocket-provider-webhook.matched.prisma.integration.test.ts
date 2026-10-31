/**
 * Real HTTP + Prisma integration: matched Shiprocket tracking webhooks.
 * Requires TEST_DATABASE_URL → doot_pg_concurrency_test on localhost only.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { tryPostgresConcurrencyTestDatabaseUrl } from "./helpers/postgres-concurrency-test-database.js";

const webhookIntegrationState = vi.hoisted(() => ({
  enabled: true,
  token: "shiprocket-matched-prisma-integration-secret",
}));

const pgIntegrationEnv = vi.hoisted(() => {
  const raw = process.env.TEST_DATABASE_URL?.trim();
  if (!raw) {
    return { testDatabaseUrl: undefined as string | undefined };
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid URL.");
  }
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (dbName !== "doot_pg_concurrency_test") {
    throw new Error(
      'TEST_DATABASE_URL database must be exactly "doot_pg_concurrency_test".',
    );
  }
  process.env.DATABASE_URL = raw;
  process.env.DIRECT_URL = raw;
  process.env.NODE_ENV = "test";
  return { testDatabaseUrl: raw };
});

vi.mock("../src/config/env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config/env.js")>();
  return {
    ...actual,
    get env() {
      const databaseUrl = process.env.DATABASE_URL ?? actual.env.DATABASE_URL;
      return {
        ...actual.env,
        DATABASE_URL: databaseUrl,
        DIRECT_URL: process.env.DIRECT_URL ?? actual.env.DIRECT_URL,
        NODE_ENV: "test" as const,
        SHIPROCKET_WEBHOOK_ENABLED: webhookIntegrationState.enabled,
        SHIPROCKET_WEBHOOK_TOKEN: webhookIntegrationState.token,
        SHIPROCKET_WEBHOOK_API_KEY: undefined,
      };
    },
    requireShiprocketWebhookApiKey: () => {
      if (!webhookIntegrationState.enabled) {
        throw new Error("SHIPROCKET_WEBHOOK_ENABLED is false");
      }
      return webhookIntegrationState.token;
    },
  };
});

const validatedTestDatabaseUrl = tryPostgresConcurrencyTestDatabaseUrl(
  pgIntegrationEnv.testDatabaseUrl,
);

const describeIntegration = validatedTestDatabaseUrl ? describe : describe.skip;

const ROUTE = "/api/v1/providers/webhooks/shiprocket";

function buildMatchedPayload(input: {
  awb: string;
  srOrderId: string;
  scanStatus: string;
  scanDate: string;
  isReturn?: boolean;
  extraScans?: Record<string, unknown>[];
}): string {
  const scans = input.extraScans ?? [
    {
      date: input.scanDate,
      activity: "In transit",
      location: "Hub",
      status: input.scanStatus,
      status_id: 17,
    },
  ];
  return JSON.stringify({
    awb: input.awb,
    sr_order_id: input.srOrderId,
    order_id: input.srOrderId,
    current_status: input.scanStatus,
    current_status_id: 17,
    current_timestamp: input.scanDate,
    is_return: input.isReturn ?? false,
    scans,
  });
}

describeIntegration(
  "Shiprocket matched webhook (Prisma + HTTP integration)",
  { timeout: 30_000 },
  () => {
    const TEST_DATABASE_URL = validatedTestDatabaseUrl!;
    let prisma: PrismaClient;
    let app: ReturnType<typeof import("../src/app.js").createApp>;
    let disconnectDatabase: typeof import("../src/config/database.js").disconnectDatabase;

    const customerId = randomUUID();
    const providerId = randomUUID();
    const providerCode = `SHIPROCKET_WH_IT_${randomUUID().slice(0, 8)}`;

    const matchedDeliveryId = randomUUID();
    const matchedBookingId = randomUUID();
    const matchedAwb = "SR123456789IN";
    const matchedOrderId = "80808080";

    const decoyDeliveryId = randomUUID();
    const decoyBookingId = randomUUID();
    const decoyAwb = "SR999888777IN";

    const otpDeliveryId = randomUUID();
    const otpBookingId = randomUUID();
    const otpAwb = "SR111222333IN";
    const otpOrderId = "70707070";

    const pickedUpDeliveryId = randomUUID();
    const pickedUpBookingId = randomUUID();
    const pickedUpAwb = "SR444555666IN";
    const pickedUpOrderId = "60606060";

    const correlationMatched = `corr-matched-${matchedDeliveryId.slice(0, 8)}`;
    const correlationDecoy = `corr-decoy-${decoyDeliveryId.slice(0, 8)}`;
    const correlationOtp = `corr-otp-${otpDeliveryId.slice(0, 8)}`;
    const correlationPickedUp = `corr-picked-${pickedUpDeliveryId.slice(0, 8)}`;

    beforeAll(async () => {
      const dbMod = await import("../src/config/database.js");
      disconnectDatabase = dbMod.disconnectDatabase;
      await disconnectDatabase();

      prisma = new PrismaClient({
        datasources: { db: { url: TEST_DATABASE_URL } },
      });
      await prisma.$connect();

      const { createApp } = await import("../src/app.js");
      app = createApp({ exposeSwagger: false });

      await prisma.user.create({
        data: {
          id: customerId,
          name: "Webhook Matched Integration",
          email: `wh-matched-${customerId}@example.test`,
        },
      });

      await prisma.provider.create({
        data: {
          id: providerId,
          code: providerCode,
          name: "Shiprocket Webhook Integration Provider",
          environment: "SANDBOX",
          enabled: true,
          orchestrationEnabled: true,
          integrationStatus: "CONFIGURED",
          settings: { create: {} },
        },
      });

      const quoteSnapshot = (awb: string) => ({
        amount: 150,
        currency: "INR",
        quotedAt: new Date().toISOString(),
        providerMetadata: { shiprocketAwbCode: awb },
      });

      await prisma.delivery.createMany({
        data: [
          {
            id: matchedDeliveryId,
            reference: `WM-${matchedDeliveryId.slice(0, 8)}`,
            customerId,
            status: "BOOKED",
          },
          {
            id: decoyDeliveryId,
            reference: `WD-${decoyDeliveryId.slice(0, 8)}`,
            customerId,
            status: "BOOKED",
          },
          {
            id: otpDeliveryId,
            reference: `WO-${otpDeliveryId.slice(0, 8)}`,
            customerId,
            status: "PICKUP_OTP_PENDING",
          },
          {
            id: pickedUpDeliveryId,
            reference: `WP-${pickedUpDeliveryId.slice(0, 8)}`,
            customerId,
            status: "PICKED_UP",
          },
        ],
      });

      await prisma.providerBooking.createMany({
        data: [
          {
            id: matchedBookingId,
            deliveryId: matchedDeliveryId,
            attemptNumber: 1,
            orchestrationRequestId: randomUUID(),
            orchestrationOptionId: randomUUID(),
            providerId,
            providerCode: "SHIPROCKET",
            status: "BOOKED",
            correlationReference: correlationMatched,
            providerOrderId: matchedOrderId,
            quoteSnapshot: quoteSnapshot(matchedAwb),
            bookedAt: new Date(),
          },
          {
            id: decoyBookingId,
            deliveryId: decoyDeliveryId,
            attemptNumber: 1,
            orchestrationRequestId: randomUUID(),
            orchestrationOptionId: randomUUID(),
            providerId,
            providerCode: "SHIPROCKET",
            status: "BOOKED",
            correlationReference: correlationDecoy,
            providerOrderId: "90909091",
            quoteSnapshot: quoteSnapshot(decoyAwb),
            bookedAt: new Date(),
          },
          {
            id: otpBookingId,
            deliveryId: otpDeliveryId,
            attemptNumber: 1,
            orchestrationRequestId: randomUUID(),
            orchestrationOptionId: randomUUID(),
            providerId,
            providerCode: "SHIPROCKET",
            status: "BOOKED",
            correlationReference: correlationOtp,
            providerOrderId: otpOrderId,
            quoteSnapshot: quoteSnapshot(otpAwb),
            bookedAt: new Date(),
          },
          {
            id: pickedUpBookingId,
            deliveryId: pickedUpDeliveryId,
            attemptNumber: 1,
            orchestrationRequestId: randomUUID(),
            orchestrationOptionId: randomUUID(),
            providerId,
            providerCode: "SHIPROCKET",
            status: "BOOKED",
            correlationReference: correlationPickedUp,
            providerOrderId: pickedUpOrderId,
            quoteSnapshot: quoteSnapshot(pickedUpAwb),
            bookedAt: new Date(),
          },
        ],
      });
    });

    afterAll(async () => {
      if (!prisma) {
        return;
      }
      const deliveryIds = [
        matchedDeliveryId,
        decoyDeliveryId,
        otpDeliveryId,
        pickedUpDeliveryId,
      ];
      await prisma.deliveryTrackingPoint.deleteMany({
        where: { deliveryId: { in: deliveryIds } },
      });
      await prisma.providerWebhookEvent.deleteMany({
        where: {
          OR: [
            { providerDeliveryId: matchedAwb },
            { providerDeliveryId: decoyAwb },
            { providerDeliveryId: otpAwb },
            { providerDeliveryId: pickedUpAwb },
            { providerDeliveryId: "SR000000000IN" },
          ],
        },
      });
      await prisma.providerBooking.deleteMany({
        where: {
          id: {
            in: [matchedBookingId, decoyBookingId, otpBookingId, pickedUpBookingId],
          },
        },
      });
      await prisma.delivery.deleteMany({ where: { id: { in: deliveryIds } } });
      await prisma.provider.deleteMany({ where: { id: providerId } });
      await prisma.user.deleteMany({ where: { id: customerId } });
      await prisma.$disconnect();
      await disconnectDatabase();
    });

    function postWebhook(body: string, apiKey?: string) {
      const req = request(app).post(ROUTE).set("Content-Type", "application/json");
      if (apiKey !== undefined) {
        req.set("x-api-key", apiKey);
      }
      return req.send(body);
    }

    it("matches BOOKED booking via Prisma AWB link, persists PROCESSED event and tracking", async () => {
      const body = buildMatchedPayload({
        awb: matchedAwb,
        srOrderId: matchedOrderId,
        scanStatus: "IN TRANSIT",
        scanDate: "2026-04-01 10:00:00",
      });

      const decoyPointsBefore = await prisma.deliveryTrackingPoint.count({
        where: { deliveryId: decoyDeliveryId },
      });

      const response = await postWebhook(body, webhookIntegrationState.token);
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data?.processingStatus).toBe("PROCESSED");
      expect(response.body.data?.duplicate).toBe(false);
      expect(response.body.data?.trackingPointsCreated).toBeGreaterThanOrEqual(1);

      const events = await prisma.providerWebhookEvent.findMany({
        where: { providerCode: "SHIPROCKET", providerDeliveryId: matchedAwb },
        orderBy: { createdAt: "desc" },
      });
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0]?.processingStatus).toBe("PROCESSED");

      const points = await prisma.deliveryTrackingPoint.findMany({
        where: { deliveryId: matchedDeliveryId },
      });
      expect(points.length).toBeGreaterThanOrEqual(1);
      expect(points.every((p) => p.providerBookingId === matchedBookingId)).toBe(true);
      expect(points.every((p) => p.providerId === providerId)).toBe(true);
      expect(points.every((p) => p.source === "PROVIDER_WEBHOOK")).toBe(true);

      const delivery = await prisma.delivery.findUnique({
        where: { id: matchedDeliveryId },
      });
      expect(delivery?.status).toBe("BOOKED");

      const decoyPointsAfter = await prisma.deliveryTrackingPoint.count({
        where: { deliveryId: decoyDeliveryId },
      });
      expect(decoyPointsAfter).toBe(decoyPointsBefore);
    });

    it("deduplicates identical webhook payload (HTTP 200, duplicate, no extra rows)", async () => {
      const body = buildMatchedPayload({
        awb: matchedAwb,
        srOrderId: matchedOrderId,
        scanStatus: "IN TRANSIT",
        scanDate: "2026-04-01 10:00:00",
      });

      const eventsBefore = await prisma.providerWebhookEvent.count({
        where: { providerDeliveryId: matchedAwb },
      });
      const pointsBefore = await prisma.deliveryTrackingPoint.count({
        where: { deliveryId: matchedDeliveryId },
      });

      const second = await postWebhook(body, webhookIntegrationState.token);
      expect(second.status).toBe(200);
      expect(second.body.data?.duplicate).toBe(true);
      expect(second.body.data?.trackingPointsCreated).toBe(0);
      expect(second.body.data?.reason).toBe("duplicate_provider_event_key");

      const eventsAfter = await prisma.providerWebhookEvent.count({
        where: { providerDeliveryId: matchedAwb },
      });
      const pointsAfter = await prisma.deliveryTrackingPoint.count({
        where: { deliveryId: matchedDeliveryId },
      });

      expect(eventsAfter).toBe(eventsBefore);
      expect(pointsAfter).toBe(pointsBefore);

      const terminal = await prisma.providerWebhookEvent.findFirst({
        where: { providerDeliveryId: matchedAwb, processingStatus: "PROCESSED" },
      });
      expect(terminal).not.toBeNull();
    });

    it("deduplicates repeated scan via providerEventId when payload hash differs", async () => {
      const scanDate = "2026-04-02 11:30:00";
      const firstBody = buildMatchedPayload({
        awb: pickedUpAwb,
        srOrderId: pickedUpOrderId,
        scanStatus: "IN TRANSIT",
        scanDate,
      });
      const secondBody = JSON.stringify({
        ...JSON.parse(firstBody),
        current_timestamp: "2026-04-02 12:00:00",
      });

      const first = await postWebhook(firstBody, webhookIntegrationState.token);
      expect(first.status).toBe(200);
      expect(first.body.data?.processingStatus).toBe("PROCESSED");

      const pointsAfterFirst = await prisma.deliveryTrackingPoint.count({
        where: { deliveryId: pickedUpDeliveryId },
      });
      expect(pointsAfterFirst).toBe(1);

      const second = await postWebhook(secondBody, webhookIntegrationState.token);
      expect(second.status).toBe(200);

      const pointsAfterSecond = await prisma.deliveryTrackingPoint.count({
        where: { deliveryId: pickedUpDeliveryId },
      });
      expect(pointsAfterSecond).toBe(1);

      const pickedUpDelivery = await prisma.delivery.findUnique({
        where: { id: pickedUpDeliveryId },
      });
      expect(pickedUpDelivery?.status).toBe("IN_TRANSIT");
    });

    it("returns IGNORED for authenticated unmatched AWB without tracking rows", async () => {
      const unmatchedAwb = "SR000000000IN";
      const body = buildMatchedPayload({
        awb: unmatchedAwb,
        srOrderId: "99999999",
        scanStatus: "IN TRANSIT",
        scanDate: "2026-04-03 09:00:00",
      });

      const eventsBefore = await prisma.providerWebhookEvent.count({
        where: { providerDeliveryId: unmatchedAwb },
      });
      const response = await postWebhook(body, webhookIntegrationState.token);
      expect(response.status).toBe(200);
      expect(response.body.data?.processingStatus).toBe("IGNORED");
      expect(response.body.data?.reason).toBe("delivery_not_found");

      const ignoredEvent = await prisma.providerWebhookEvent.findFirst({
        where: { providerDeliveryId: unmatchedAwb, processingStatus: "IGNORED" },
      });
      expect(ignoredEvent).not.toBeNull();

      expect(
        await prisma.deliveryTrackingPoint.count({
          where: { deliveryId: decoyDeliveryId },
        }),
      ).toBe(0);

      const eventsAfter = await prisma.providerWebhookEvent.count({
        where: { providerDeliveryId: unmatchedAwb },
      });
      expect(eventsAfter).toBe(eventsBefore + 1);
    });

    it("returns 401 for missing API key without persisting webhook events", async () => {
      const body = buildMatchedPayload({
        awb: matchedAwb,
        srOrderId: matchedOrderId,
        scanStatus: "IN TRANSIT",
        scanDate: "2026-04-04 08:00:00",
      });

      const eventsBefore = await prisma.providerWebhookEvent.count({
        where: { providerDeliveryId: matchedAwb },
      });
      const response = await postWebhook(body);
      expect(response.status).toBe(401);
      expect(response.body.error?.code).toBe(
        ErrorCodes.INVALID_PROVIDER_WEBHOOK_SIGNATURE,
      );
      expect(
        await prisma.providerWebhookEvent.count({
          where: { providerDeliveryId: matchedAwb },
        }),
      ).toBe(eventsBefore);
    });

    it("records RTO (is_return) tracking without forward lifecycle transition", async () => {
      const body = buildMatchedPayload({
        awb: decoyAwb,
        srOrderId: "90909091",
        scanStatus: "IN TRANSIT",
        scanDate: "2026-04-05 12:00:00",
        isReturn: true,
      });

      const response = await postWebhook(body, webhookIntegrationState.token);
      expect(response.status).toBe(200);
      expect(response.body.data?.processingStatus).toBe("PROCESSED");

      const decoy = await prisma.delivery.findUnique({
        where: { id: decoyDeliveryId },
      });
      expect(decoy?.status).toBe("BOOKED");

      const points = await prisma.deliveryTrackingPoint.findMany({
        where: { deliveryId: decoyDeliveryId },
      });
      expect(points.length).toBeGreaterThanOrEqual(1);
      const meta = points[0]?.metadata as Record<string, unknown> | null;
      expect(meta?.shiprocketIsReturn).toBe(true);
    });

    it("does not advance lifecycle on DELIVERED or PICKED_UP scans while OTP is pending", async () => {
      const body = buildMatchedPayload({
        awb: otpAwb,
        srOrderId: otpOrderId,
        scanStatus: "DELIVERED",
        scanDate: "2026-04-06 18:00:00",
        extraScans: [
          {
            date: "2026-04-06 17:00:00",
            activity: "Picked up",
            location: "Origin",
            status: "PICKED UP",
            status_id: 6,
          },
          {
            date: "2026-04-06 18:00:00",
            activity: "Delivered",
            location: "Destination",
            status: "DELIVERED",
            status_id: 7,
          },
        ],
      });

      const response = await postWebhook(body, webhookIntegrationState.token);
      expect(response.status).toBe(200);
      expect(response.body.data?.processingStatus).toBe("PROCESSED");

      const otpDelivery = await prisma.delivery.findUnique({
        where: { id: otpDeliveryId },
      });
      expect(otpDelivery?.status).toBe("PICKUP_OTP_PENDING");
    });
  },
);
