import { PrismaClient } from "@prisma/client";
import { env } from "./env.js";
import { logger } from "./logger.js";

const globalForPrisma = globalThis as typeof globalThis & {
  __duttPrisma?: PrismaClient;
};

let prisma: PrismaClient | null = null;

function createPrismaClient(): PrismaClient {
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required before initializing the Prisma client",
    );
  }

  return new PrismaClient({
    datasources: {
      db: {
        url: env.DATABASE_URL,
      },
    },
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

/**
 * Returns the shared PrismaClient singleton.
 * Does not connect on import; connection happens on first query or connectDatabase().
 */
export function getPrismaClient(): PrismaClient {
  if (prisma) {
    return prisma;
  }

  if (env.NODE_ENV !== "production" && globalForPrisma.__duttPrisma) {
    prisma = globalForPrisma.__duttPrisma;
    return prisma;
  }

  prisma = createPrismaClient();

  if (env.NODE_ENV !== "production") {
    globalForPrisma.__duttPrisma = prisma;
  }

  return prisma;
}

/**
 * Explicit connectivity check. Call when a feature needs the database.
 * Server bootstrap must not depend on this succeeding.
 */
export async function connectDatabase(): Promise<void> {
  if (!env.DATABASE_URL) {
    logger.warn(
      "DATABASE_URL is not set; skipping database connection for this process",
    );
    return;
  }

  const client = getPrismaClient();
  await client.$connect();
  logger.info("Database connection established");
}

export async function disconnectDatabase(): Promise<void> {
  const client = prisma ?? globalForPrisma.__duttPrisma;
  if (!client) {
    return;
  }

  await client.$disconnect();
  prisma = null;
  globalForPrisma.__duttPrisma = undefined;
  logger.info("Database connection closed");
}
