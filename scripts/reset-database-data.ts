#!/usr/bin/env tsx
/**
 * Deletes all application data while preserving schema and migration history.
 *
 * Usage:
 *   ALLOW_DATABASE_DATA_RESET=true NODE_ENV=development tsx scripts/reset-database-data.ts
 */
/* eslint-disable no-console -- CLI status output (no secrets) */
import { PrismaClient } from "@prisma/client";
import { env } from "../src/config/env.js";
import {
  assertCleanupAllowed,
  CleanupRefusedError,
  formatModelCounts,
  runDatabaseDataReset,
} from "./reset-database-data.lib.js";

async function main(): Promise<void> {
  assertCleanupAllowed();

  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required. Cannot connect to the database.",
    );
  }

  const prisma = new PrismaClient({
    datasources: {
      db: { url: env.DATABASE_URL },
    },
  });

  try {
    await prisma.$connect();
    console.info("Database connection established.");

    const result = await runDatabaseDataReset(prisma, env.DATABASE_URL);

    console.info("\nTarget database (safe identification only):");
    console.info(`  provider: ${result.database.provider}`);
    console.info(`  host: ${result.database.host}`);
    console.info(`  port: ${result.database.port}`);
    console.info(`  database: ${result.database.database}`);

    console.info("\nBEFORE");
    console.info(formatModelCounts(result.before));

    console.info("\nDELETED (rows removed per model)");
    console.info(
      Object.entries(result.deleted)
        .filter(([, count]) => count > 0)
        .map(([model, count]) => `${model}: ${count}`)
        .join("\n") || "(no rows deleted)",
    );

    console.info("\nAFTER");
    console.info(formatModelCounts(result.after));

    console.info("\nDelivery reference sequence:");
    console.info(`  last_value: ${result.sequence.lastValue}`);
    console.info(`  is_called: ${result.sequence.isCalled}`);
    console.info(`  next_reference: ${result.sequence.nextReference}`);

    console.info("\nAdmin seed:");
    if (result.adminSeed === "skipped") {
      console.info(
        "  skipped (set ADMIN_EMAIL and ADMIN_PASSWORD to provision an admin)",
      );
    } else if (result.adminSeed === "created") {
      console.info("  created configured admin user");
    } else {
      console.info("  updated configured admin user");
    }

    console.info("\nDATABASE CLEAN — READY FOR AUTHENTICATION TESTING");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof CleanupRefusedError) {
    console.error(error.message);
    process.exit(1);
  }

  console.error("Database data cleanup failed.");
  if (error instanceof Error && error.message) {
    console.error(error.message);
  }
  process.exit(1);
});
