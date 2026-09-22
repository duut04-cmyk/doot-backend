import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import {
  ProviderAdapterResolver,
  providerAdapterResolver,
} from "../provider/adapters/provider-adapter-resolver.js";
import {
  operationalRefreshService,
  type OperationalRefreshService,
} from "./operational-refresh.service.js";
import {
  operationalPollingLock,
  type IOperationalPollingLock,
} from "./operational-polling.lock.js";
import {
  operationalPollingRepository,
  type IOperationalPollingRepository,
  type OperationalPollingCandidate,
} from "./operational-polling.repository.js";

export class OperationalPollingService {
  private timer: NodeJS.Timeout | null = null;
  private cycleInProgress = false;

  constructor(
    private readonly pollingRepo: IOperationalPollingRepository = operationalPollingRepository,
    private readonly refresh: OperationalRefreshService = operationalRefreshService,
    private readonly lock: IOperationalPollingLock = operationalPollingLock,
    private readonly adapterResolver: ProviderAdapterResolver = providerAdapterResolver,
  ) {}

  start(): void {
    if (!env.OPERATIONAL_POLLING_ENABLED) {
      return;
    }
    if (this.timer) {
      return;
    }

    logger.info(
      {
        intervalMs: env.OPERATIONAL_POLL_INTERVAL_MS,
        batchSize: env.OPERATIONAL_POLL_BATCH_SIZE,
      },
      "operational_polling.started",
    );

    this.timer = setInterval(() => {
      void this.runCycle(`poll-${randomUUID()}`);
    }, env.OPERATIONAL_POLL_INTERVAL_MS);
    this.timer.unref();

    void this.runCycle(`poll-${randomUUID()}`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info("operational_polling.stopped");
    }
  }

  async runCycle(requestId: string): Promise<void> {
    if (this.cycleInProgress) {
      logger.debug({ requestId }, "operational_polling.cycle_skipped");
      return;
    }

    this.cycleInProgress = true;
    try {
      const candidates = await this.pollingRepo.findEligibleDeliveries(
        env.OPERATIONAL_POLL_BATCH_SIZE,
      );

      logger.info(
        { requestId, candidateCount: candidates.length },
        "operational_polling.cycle_started",
      );

      for (const candidate of candidates) {
        await this.pollDelivery(candidate, requestId);
      }
    } catch (error) {
      logger.error({ err: error, requestId }, "operational_polling.cycle_failed");
    } finally {
      this.cycleInProgress = false;
    }
  }

  private async pollDelivery(
    candidate: OperationalPollingCandidate,
    requestId: string,
  ): Promise<void> {
    if (!(await this.isProviderEligible(candidate, requestId))) {
      return;
    }

    const release = await this.lock.tryAcquire(candidate.deliveryId);
    if (!release) {
      logger.debug(
        { requestId, deliveryId: candidate.deliveryId },
        "operational_polling.delivery_skipped_locked",
      );
      return;
    }

    try {
      const result = await this.refresh.refreshFromProvider({
        deliveryId: candidate.deliveryId,
        requestId: `${requestId}:${candidate.deliveryId}`,
        source: "PROVIDER_POLL",
        failureMode: "preserve",
      });

      if (!result.pollSucceeded) {
        logger.warn(
          { requestId, deliveryId: candidate.deliveryId },
          "operational_polling.delivery_refresh_failed",
        );
      }
    } finally {
      await release();
    }
  }

  private async isProviderEligible(
    candidate: OperationalPollingCandidate,
    requestId: string,
  ): Promise<boolean> {
    try {
      await this.adapterResolver.resolveForExecution({
        providerCode: candidate.providerCode,
        operation: "getTracking",
        requestId,
      });
      return true;
    } catch (error) {
      if (
        error instanceof AppError &&
        (error.code === ErrorCodes.PROVIDER_UNSUPPORTED_OPERATION ||
          error.code === ErrorCodes.PROVIDER_NOT_READY ||
          error.code === ErrorCodes.PROVIDER_DISABLED ||
          error.code === ErrorCodes.PROVIDER_ADAPTER_NOT_AVAILABLE)
      ) {
        logger.debug(
          {
            requestId,
            deliveryId: candidate.deliveryId,
            providerCode: candidate.providerCode,
            code: error.code,
          },
          "operational_polling.delivery_skipped_ineligible",
        );
        return false;
      }
      throw error;
    }
  }
}

export const operationalPollingService = new OperationalPollingService();
