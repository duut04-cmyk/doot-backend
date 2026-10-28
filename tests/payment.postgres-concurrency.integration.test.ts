/**
 * PostgreSQL concurrency integration tests.
 * Requires TEST_DATABASE_URL (disposable DB only). Never uses .env production credentials.
 */
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentGateway } from "../src/modules/payment/gateways/payment-gateway.interface.js";
import { assertPostgresConcurrencyTestDatabaseUrl } from "./helpers/postgres-concurrency-test-database.js";

const rawTestDatabaseUrl = process.env.TEST_DATABASE_URL;

let validatedTestDatabaseUrl: string | undefined;
if (rawTestDatabaseUrl) {
  validatedTestDatabaseUrl =
    assertPostgresConcurrencyTestDatabaseUrl(rawTestDatabaseUrl);
  process.env.DATABASE_URL = validatedTestDatabaseUrl;
  process.env.DIRECT_URL = validatedTestDatabaseUrl;
  process.env.NODE_ENV = "test";
}

const describePg = rawTestDatabaseUrl ? describe : describe.skip;

const gatewayMocks = vi.hoisted(() => ({
  createRefund: vi.fn<PaymentGateway["createRefund"]>(),
}));

vi.mock("../src/modules/payment/gateways/payment-gateway.registry.js", () => ({
  getPaymentGateway: () =>
    ({
      code: "STUB",
      createPaymentOrder: vi.fn(),
      getPaymentStatus: vi.fn(),
      verifyPayment: vi.fn(),
      createRefund: gatewayMocks.createRefund,
      getRefundStatus: vi.fn(),
    }) satisfies PaymentGateway,
}));

describePg("Payment PostgreSQL concurrency (integration)", () => {
  const TEST_DATABASE_URL = validatedTestDatabaseUrl!;
  let prisma: PrismaClient;
  let PaymentService: typeof import("../src/modules/payment/payment.service.js").PaymentService;
  let PrismaPaymentRepository: typeof import("../src/modules/payment/payment.repository.js").PrismaPaymentRepository;
  let disconnectDatabase: typeof import("../src/config/database.js").disconnectDatabase;
  let service: InstanceType<typeof PaymentService>;
  let paymentRepo: InstanceType<typeof PrismaPaymentRepository>;
  let paymentId: string;
  let deliveryId: string;

  beforeAll(async () => {
    const dbMod = await import("../src/config/database.js");
    disconnectDatabase = dbMod.disconnectDatabase;
    await disconnectDatabase();

    prisma = new PrismaClient({
      datasources: { db: { url: TEST_DATABASE_URL } },
    });
    await prisma.$connect();

    const payMod = await import("../src/modules/payment/payment.service.js");
    const repoMod = await import("../src/modules/payment/payment.repository.js");
    PaymentService = payMod.PaymentService;
    PrismaPaymentRepository = repoMod.PrismaPaymentRepository;

    const { InMemoryDeliveryRepository } =
      await import("./helpers/in-memory-delivery-repository.js");
    const { InMemoryOrchestrationRepository } =
      await import("./helpers/in-memory-orchestration-repository.js");

    paymentRepo = new PrismaPaymentRepository();
    service = new PaymentService(
      paymentRepo,
      new InMemoryDeliveryRepository(),
      new InMemoryOrchestrationRepository(),
      "STUB",
    );
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
    await disconnectDatabase?.();
  });

  beforeEach(async () => {
    gatewayMocks.createRefund.mockReset();
    gatewayMocks.createRefund.mockResolvedValue({
      gatewayRefundId: "gw-mock",
      gatewayRefundReference: "cf-mock",
      status: "PENDING",
    });

    await prisma.refund.deleteMany();
    await prisma.ledgerEntry.deleteMany();
    await prisma.paymentAttempt.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.delivery.deleteMany();
    await prisma.user.deleteMany();

    const suffix = randomUUID();
    const user = await prisma.user.create({
      data: {
        name: "Pg Concurrency User",
        email: `pg-concurrency-${suffix}@doot.test`,
        role: "CUSTOMER",
      },
    });
    const delivery = await prisma.delivery.create({
      data: {
        reference: `PG-${suffix}`,
        customerId: user.id,
        status: "OPTION_READY",
      },
    });
    deliveryId = delivery.id;
    const payment = await prisma.payment.create({
      data: {
        deliveryId: delivery.id,
        customerId: user.id,
        amount: new Prisma.Decimal(100),
        currency: "INR",
        status: "PAID",
        gateway: "STUB",
        gatewayOrderId: `order-${suffix}`,
        pricingSource: { test: true },
        paidAt: new Date(),
        refundedAmount: new Prisma.Decimal(0),
      },
    });
    paymentId = payment.id;
  });

  async function sumActiveRefundAmountsFromDb(forPaymentId: string): Promise<number> {
    const rows = await prisma.refund.findMany({
      where: {
        paymentId: forPaymentId,
        status: { in: ["REQUESTED", "PENDING", "SUCCESS"] },
      },
      select: { amount: true },
    });
    return rows.reduce((sum, row) => sum + Number(row.amount), 0);
  }

  it("same idempotency key concurrently: one refund row, at most one gateway call", async () => {
    gatewayMocks.createRefund.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                gatewayRefundId: "gw-same",
                status: "PENDING",
              }),
            30,
          );
        }),
    );

    const key = `idem-${randomUUID()}`;
    const results = await Promise.allSettled([
      service.requestRefund({ paymentId, amount: 40, idempotencyKey: key }),
      service.requestRefund({ paymentId, amount: 40, idempotencyKey: key }),
    ]);

    const refundCount = await prisma.refund.count({
      where: { idempotencyKey: key },
    });
    expect(refundCount).toBe(1);
    expect(gatewayMocks.createRefund.mock.calls.length).toBeLessThanOrEqual(1);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
  });

  it("different keys 60+60 on paid 100: active reservations never exceed 100", async () => {
    gatewayMocks.createRefund.mockResolvedValue({
      gatewayRefundId: "gw-pend",
      status: "PENDING",
    });

    const results = await Promise.allSettled([
      service.requestRefund({
        paymentId,
        amount: 60,
        idempotencyKey: `key-a-${randomUUID()}`,
      }),
      service.requestRefund({
        paymentId,
        amount: 60,
        idempotencyKey: `key-b-${randomUUID()}`,
      }),
    ]);

    const activeSum = await sumActiveRefundAmountsFromDb(paymentId);
    expect(activeSum).toBeLessThanOrEqual(100);

    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected.length).toBe(1);
  });

  it("concurrent finalize of 40+60 refunds: refundedAmount exactly 100", async () => {
    const r40 = await prisma.refund.create({
      data: {
        paymentId,
        deliveryId,
        amount: new Prisma.Decimal(40),
        currency: "INR",
        status: "PENDING",
        idempotencyKey: `fin-40-${randomUUID()}`,
        gatewayRefundId: "gw-40",
      },
    });
    const r60 = await prisma.refund.create({
      data: {
        paymentId,
        deliveryId,
        amount: new Prisma.Decimal(60),
        currency: "INR",
        status: "PENDING",
        idempotencyKey: `fin-60-${randomUUID()}`,
        gatewayRefundId: "gw-60",
      },
    });

    await Promise.all([
      service.markRefundSuccessful({ refundId: r40.id, gatewayRefundId: "gw-40" }),
      service.markRefundSuccessful({ refundId: r60.id, gatewayRefundId: "gw-60" }),
    ]);

    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    expect(Number(payment?.refundedAmount)).toBe(100);
    expect(payment?.status).toBe("REFUNDED");
  });

  it("duplicate finalize of same refund: refundedAmount increments once", async () => {
    const refund = await prisma.refund.create({
      data: {
        paymentId,
        deliveryId,
        amount: new Prisma.Decimal(100),
        currency: "INR",
        status: "PENDING",
        idempotencyKey: `dup-fin-${randomUUID()}`,
        gatewayRefundId: "gw-dup",
      },
    });

    await Promise.all([
      service.markRefundSuccessful({ refundId: refund.id, gatewayRefundId: "gw-dup" }),
      service.markRefundSuccessful({ refundId: refund.id, gatewayRefundId: "gw-dup" }),
    ]);

    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    expect(Number(payment?.refundedAmount)).toBe(100);
    const ledgerCount = await prisma.ledgerEntry.count({
      where: { paymentId, refundId: refund.id },
    });
    expect(ledgerCount).toBe(1);
  });

  it("payment FOR UPDATE blocks reservation until the holding transaction commits", async () => {
    const clientA = new PrismaClient({
      datasources: { db: { url: TEST_DATABASE_URL } },
    });

    let releaseHold!: () => void;
    const holdOpen = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });

    let reserveCompleted = false;
    const key = `lock-${randomUUID()}`;

    const txA = clientA.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM "Payment" WHERE id = ${paymentId}::uuid FOR UPDATE
      `;
      await holdOpen;
    });

    await new Promise((r) => setTimeout(r, 100));

    const reservePromise = service
      .requestRefund({ paymentId, amount: 10, idempotencyKey: key })
      .then(() => {
        reserveCompleted = true;
      });

    await new Promise((r) => setTimeout(r, 250));
    expect(reserveCompleted).toBe(false);

    releaseHold();
    await Promise.all([txA, reservePromise]);
    expect(reserveCompleted).toBe(true);

    const count = await prisma.refund.count({ where: { idempotencyKey: key } });
    expect(count).toBe(1);

    await clientA.$disconnect();
  });
});
