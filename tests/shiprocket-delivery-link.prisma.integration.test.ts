/**
 * Optional PostgreSQL integration for AWB JSON-path delivery linking.
 * Requires TEST_DATABASE_URL (same disposable guard as payment concurrency tests).
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertPostgresConcurrencyTestDatabaseUrl } from "./helpers/postgres-concurrency-test-database.js";

const rawTestDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeIntegration = rawTestDatabaseUrl ? describe : describe.skip;

describeIntegration("PrismaProviderDeliveryLinkResolver (AWB JSON path)", () => {
  let prisma: PrismaClient;
  let resolver: import("../src/modules/provider/provider.delivery-link.prisma.js").PrismaProviderDeliveryLinkResolver;
  let deliveryId: string;
  let customerId: string;
  let bookingId: string;
  const awb = "SR987654321IN";

  beforeAll(async () => {
    const url = assertPostgresConcurrencyTestDatabaseUrl(rawTestDatabaseUrl);
    process.env.DATABASE_URL = url;
    process.env.DIRECT_URL = url;

    const mod =
      await import("../src/modules/provider/provider.delivery-link.prisma.js");
    resolver = mod.prismaProviderDeliveryLinkResolver;

    prisma = new PrismaClient({ datasources: { db: { url } } });

    customerId = randomUUID();
    deliveryId = randomUUID();
    bookingId = randomUUID();

    await prisma.user.create({
      data: {
        id: customerId,
        name: "Webhook Link Test",
        email: `webhook-link-${customerId}@example.test`,
      },
    });

    await prisma.delivery.create({
      data: {
        id: deliveryId,
        reference: `WH-${deliveryId.slice(0, 8)}`,
        customerId,
        status: "BOOKED",
      },
    });

    await prisma.providerBooking.create({
      data: {
        id: bookingId,
        deliveryId,
        attemptNumber: 1,
        orchestrationRequestId: randomUUID(),
        orchestrationOptionId: randomUUID(),
        providerId: randomUUID(),
        providerCode: "SHIPROCKET",
        status: "BOOKED",
        correlationReference: `corr-${deliveryId.slice(0, 8)}`,
        providerOrderId: "90909090",
        quoteSnapshot: {
          amount: 100,
          currency: "INR",
          providerMetadata: {
            shiprocketAwbCode: awb,
          },
        },
      },
    });
  });

  afterAll(async () => {
    if (!prisma) {
      return;
    }
    await prisma.providerBooking.deleteMany({ where: { id: bookingId } });
    await prisma.delivery.deleteMany({ where: { id: deliveryId } });
    await prisma.user.deleteMany({ where: { id: customerId } });
    await prisma.$disconnect();
  });

  it("resolves a BOOKED Shiprocket delivery by stored AWB metadata", async () => {
    const link = await resolver.resolveShiprocketTrackingWebhook({
      awb,
      srOrderId: null,
      orderId: null,
    });

    expect(link.outcome).toBe("matched");
    if (link.outcome === "matched") {
      expect(link.deliveryId).toBe(deliveryId);
      expect(link.bookingId).toBe(bookingId);
    }
  });
});
