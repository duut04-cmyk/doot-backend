/**
 * PostgreSQL concurrency integration for Shiprocket auth refresh lease and first login.
 * Requires TEST_DATABASE_URL (disposable DB only).
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { tryPostgresConcurrencyTestDatabaseUrl } from "./helpers/postgres-concurrency-test-database.js";

const rawTestDatabaseUrl = process.env.TEST_DATABASE_URL;

const validatedTestDatabaseUrl =
  tryPostgresConcurrencyTestDatabaseUrl(rawTestDatabaseUrl);
if (validatedTestDatabaseUrl) {
  process.env.DATABASE_URL = validatedTestDatabaseUrl;
  process.env.DIRECT_URL = validatedTestDatabaseUrl;
  process.env.NODE_ENV = "test";
}

const describePg = validatedTestDatabaseUrl ? describe : describe.skip;

describePg("Shiprocket auth PostgreSQL concurrency (integration)", () => {
  const TEST_DATABASE_URL = validatedTestDatabaseUrl!;
  let prisma: PrismaClient;
  let providerId: string;
  let disconnectDatabase: typeof import("../src/config/database.js").disconnectDatabase;

  beforeAll(async () => {
    const dbMod = await import("../src/config/database.js");
    disconnectDatabase = dbMod.disconnectDatabase;
    await disconnectDatabase();

    prisma = new PrismaClient({
      datasources: { db: { url: TEST_DATABASE_URL } },
    });
    await prisma.$connect();

    const provider = await prisma.provider.create({
      data: {
        code: `SHIPROCKET_AUTH_TEST_${randomUUID().slice(0, 8)}`,
        name: "Shiprocket Auth Test",
        environment: "SANDBOX",
        enabled: true,
        orchestrationEnabled: false,
        integrationStatus: "CONFIGURED",
        settings: { create: {} },
      },
    });
    providerId = provider.id;
  });

  beforeEach(async () => {
    await prisma.providerAuthToken.deleteMany({ where: { providerId } });
  });

  afterAll(async () => {
    if (providerId) {
      await prisma.providerAuthToken.deleteMany({ where: { providerId } });
      await prisma.provider.deleteMany({ where: { id: providerId } });
    }
    await prisma.$disconnect();
    await disconnectDatabase();
  });

  it("Prisma refresh lease allows one holder at a time", async () => {
    const { encryptCredential } =
      await import("../src/modules/provider/provider.crypto.js");
    const { PrismaProviderAuthTokenRepository } =
      await import("../src/modules/provider/provider-auth-token.repository.js");
    const repo = new PrismaProviderAuthTokenRepository();
    const encrypted = encryptCredential("lease-token");
    await repo.createSuccessfulTokenIfAbsent({
      providerId,
      encrypted,
      expiresAt: new Date(Date.now() + 60_000),
      issuedAt: new Date(),
      refreshedAt: new Date(),
    });

    const first = await repo.tryAcquireRefreshLease({
      providerId,
      leaseToken: "worker-a",
    });
    const second = await repo.tryAcquireRefreshLease({
      providerId,
      leaseToken: "worker-b",
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
    await repo.releaseRefreshLease({ providerId, leaseToken: "worker-a" });
    expect(
      await repo.tryAcquireRefreshLease({ providerId, leaseToken: "worker-c" }),
    ).toBe(true);
  });

  it("conditional save rejects wrong lease token", async () => {
    const { encryptCredential } =
      await import("../src/modules/provider/provider.crypto.js");
    const { PrismaProviderAuthTokenRepository } =
      await import("../src/modules/provider/provider-auth-token.repository.js");
    const repo = new PrismaProviderAuthTokenRepository();
    const encrypted = encryptCredential("original");
    await repo.createSuccessfulTokenIfAbsent({
      providerId,
      encrypted,
      expiresAt: new Date(Date.now() + 60_000),
      issuedAt: new Date(),
      refreshedAt: new Date(),
    });
    await repo.tryAcquireRefreshLease({ providerId, leaseToken: "holder" });
    const ciphertextBefore = (await repo.findByProviderId(providerId))!.tokenCiphertext;

    const result = await repo.saveSuccessfulTokenWithLease({
      providerId,
      leaseToken: "not-holder",
      encrypted: encryptCredential("attacker"),
      expiresAt: new Date(Date.now() + 60_000),
      issuedAt: new Date(),
      refreshedAt: new Date(),
    });
    expect(result).toBe("lease_lost");

    const row = await repo.findByProviderId(providerId);
    expect(row?.tokenCiphertext).toBe(ciphertextBefore);
  });

  it("first-login advisory xact lock serializes two concurrent transactions", async () => {
    const { ShiprocketAuthRefreshLock } =
      await import("../src/modules/provider/adapters/shiprocket/shiprocket-auth-refresh.lock.js");
    const lockA = new ShiprocketAuthRefreshLock();
    const lockB = new ShiprocketAuthRefreshLock();
    let active = 0;
    let maxActive = 0;

    const run = (lock: InstanceType<typeof ShiprocketAuthRefreshLock>) =>
      lock.runFirstLoginExclusive(`pg-serialize-${providerId}`, async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 50));
        active -= 1;
        return "ok";
      });

    const results = await Promise.all([run(lockA), run(lockB)]);
    expect(results.every((r) => r === "ok")).toBe(true);
    expect(maxActive).toBe(1);
  });
});
