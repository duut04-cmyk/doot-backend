import { getPrismaClient } from "../../config/database.js";
import { env } from "../../config/env.js";

export interface IOperationalPollingLock {
  tryAcquire(deliveryId: string): Promise<(() => Promise<void>) | null>;
}

/**
 * Combines in-process and Postgres advisory locks so concurrent poll cycles
 * (including across multiple app instances) do not process the same delivery.
 */
export class OperationalPollingLock implements IOperationalPollingLock {
  private readonly inFlight = new Set<string>();

  async tryAcquire(deliveryId: string): Promise<(() => Promise<void>) | null> {
    if (this.inFlight.has(deliveryId)) {
      return null;
    }

    let advisoryAcquired = false;
    if (env.DATABASE_URL) {
      try {
        const result = await getPrismaClient().$queryRaw<
          [{ pg_try_advisory_lock: boolean }]
        >`SELECT pg_try_advisory_lock(hashtext(${deliveryId}))`;
        advisoryAcquired = result[0]?.pg_try_advisory_lock === true;
        if (!advisoryAcquired) {
          return null;
        }
      } catch {
        // Fall back to in-process lock when DB is unavailable (e.g. local dev).
      }
    }

    this.inFlight.add(deliveryId);

    return async () => {
      this.inFlight.delete(deliveryId);
      if (advisoryAcquired && env.DATABASE_URL) {
        try {
          await getPrismaClient()
            .$queryRaw`SELECT pg_advisory_unlock(hashtext(${deliveryId}))`;
        } catch {
          // Best-effort unlock; session-scoped locks are released on disconnect.
        }
      }
    };
  }
}

export class InMemoryOperationalPollingLock implements IOperationalPollingLock {
  private readonly inFlight = new Set<string>();

  async tryAcquire(deliveryId: string): Promise<(() => Promise<void>) | null> {
    if (this.inFlight.has(deliveryId)) {
      return null;
    }
    this.inFlight.add(deliveryId);
    return async () => {
      this.inFlight.delete(deliveryId);
    };
  }
}

export const operationalPollingLock = new OperationalPollingLock();
