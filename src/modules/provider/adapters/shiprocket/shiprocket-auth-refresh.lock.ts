import { randomUUID } from "node:crypto";
import { getPrismaClient } from "../../../../config/database.js";
import { env } from "../../../../config/env.js";
import { AppError } from "../../../../core/errors/app-error.js";
import { ErrorCodes } from "../../../../core/errors/error-codes.js";
import { SHIPROCKET_AUTH_FIRST_LOGIN_TRANSACTION_MS } from "./shiprocket.constants.js";

export interface IShiprocketAuthRefreshLock {
  /**
   * Serializes first-time token creation when no DB row exists.
   * Returns null when another caller in this process is already in the exclusive section.
   */
  runFirstLoginExclusive<T>(
    providerId: string,
    fn: () => Promise<T>,
  ): Promise<T | null>;
}

/**
 * Uses `pg_advisory_xact_lock` inside a Prisma transaction so lock and work share one session.
 */
export class ShiprocketAuthRefreshLock implements IShiprocketAuthRefreshLock {
  private readonly inFlight = new Set<string>();

  async runFirstLoginExclusive<T>(
    providerId: string,
    fn: () => Promise<T>,
  ): Promise<T | null> {
    if (this.inFlight.has(providerId)) {
      return null;
    }

    if (!env.DATABASE_URL) {
      if (env.NODE_ENV === "production") {
        throw new AppError(
          "Database URL is required for Shiprocket authentication coordination across instances.",
          {
            statusCode: 503,
            code: ErrorCodes.PROVIDER_NOT_READY,
          },
        );
      }
      this.inFlight.add(providerId);
      try {
        return await fn();
      } finally {
        this.inFlight.delete(providerId);
      }
    }

    const lockKey = `shiprocket-auth-refresh:${providerId}`;
    this.inFlight.add(providerId);
    try {
      return await getPrismaClient().$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
          return await fn();
        },
        { timeout: SHIPROCKET_AUTH_FIRST_LOGIN_TRANSACTION_MS },
      );
    } finally {
      this.inFlight.delete(providerId);
    }
  }
}

export class InMemoryShiprocketAuthRefreshLock implements IShiprocketAuthRefreshLock {
  private readonly inFlight = new Set<string>();

  async runFirstLoginExclusive<T>(
    providerId: string,
    fn: () => Promise<T>,
  ): Promise<T | null> {
    if (this.inFlight.has(providerId)) {
      return null;
    }
    this.inFlight.add(providerId);
    try {
      return await fn();
    } finally {
      this.inFlight.delete(providerId);
    }
  }
}

export function createShiprocketAuthRefreshLeaseToken(): string {
  return randomUUID();
}

export const shiprocketAuthRefreshLock = new ShiprocketAuthRefreshLock();
