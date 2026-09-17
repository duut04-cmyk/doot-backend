#!/usr/bin/env tsx
/**
 * Idempotently sync MOCK provider DB capabilities with MockProviderAdapter metadata.
 *
 * Usage:
 *   npx tsx scripts/sync-mock-provider-capabilities.ts
 */
/* eslint-disable no-console -- CLI status output (no secrets) */
import { PrismaClient } from "@prisma/client";
import { env } from "../src/config/env.js";
import {
  MOCK_CAPABILITIES,
  MOCK_PROVIDER_CODE,
} from "../src/modules/provider/adapters/mock/mock-provider.constants.js";

async function main(): Promise<void> {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
  });

  try {
    await prisma.$connect();

    const provider = await prisma.provider.findUnique({
      where: { code: MOCK_PROVIDER_CODE },
      include: { capabilities: true },
    });

    if (!provider) {
      console.info(
        `Provider ${MOCK_PROVIDER_CODE} not found. Create it via POST /api/v1/admin/providers first.`,
      );
      process.exit(1);
    }

    const before = provider.capabilities.map((item) => item.capability).sort();
    const target = [...MOCK_CAPABILITIES].sort();

    const unchanged =
      before.length === target.length &&
      before.every((capability, index) => capability === target[index]);

    if (unchanged) {
      console.info(
        JSON.stringify(
          {
            providerCode: MOCK_PROVIDER_CODE,
            providerId: provider.id,
            status: "unchanged",
            capabilities: before,
          },
          null,
          2,
        ),
      );
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.providerCapabilityRecord.deleteMany({
        where: { providerId: provider.id },
      });
      await tx.providerCapabilityRecord.createMany({
        data: MOCK_CAPABILITIES.map((capability) => ({
          providerId: provider.id,
          capability,
        })),
      });
    });

    console.info(
      JSON.stringify(
        {
          providerCode: MOCK_PROVIDER_CODE,
          providerId: provider.id,
          status: "updated",
          from: before,
          to: target,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("sync-mock-provider-capabilities failed");
  throw error;
});
